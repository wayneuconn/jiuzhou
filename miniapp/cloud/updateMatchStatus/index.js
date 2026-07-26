const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const VALID_STATUSES = ['draft', 'registration_r1', 'registration_r2', 'drafting', 'ready', 'completed', 'cancelled']

// Snake draft turn for pick #i (0-based): A, B, B, A, A, B, B, A …
// Captains are auto-assigned to their teams before pick #0.
function turnForPick(i) {
  if (i === 0) return 'A'
  return Math.floor((i - 1) / 2) % 2 === 0 ? 'B' : 'A'
}

function buildPickOrder(remainingCount) {
  const order = []
  for (let i = 0; i < remainingCount; i++) order.push(turnForPick(i))
  return order
}

// Minutes ET is behind UTC (300 for EST, 240 for EDT — handles DST)
function etOffsetMinutes(date) {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const etStr = date.toLocaleString('en-US', { timeZone: 'America/New_York' })
  return Math.round((new Date(utcStr) - new Date(etStr)) / 60000)
}

// 'YYYY-MM-DD' + 'HH:mm' interpreted in ET → epoch ms
function etTimestamp(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = (timeStr || '20:00').split(':').map(Number)
  const utcBase = new Date(Date.UTC(y, m - 1, d))
  return utcBase.getTime() + etOffsetMinutes(utcBase) * 60000 + hh * 3600000 + (mm || 0) * 60000
}

async function recalcMatchState(matchId) {
  const matchSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
  if (!matchSnap.data) return
  const match = matchSnap.data
  if (!['registration_r1', 'registration_r2', 'ready'].includes(match.status)) return
  const cnt = await db.collection('registrations')
    .where({ matchId, status: _.in(['confirmed', 'promoted']) })
    .count().catch(() => ({ total: 0 }))
  const count = cnt.total ?? 0
  if (count >= match.maxPlayers && match.status !== 'ready') {
    await db.collection('matches').doc(matchId).update({ data: { status: 'ready', autoReady: true } }).catch(() => {})
  } else if (match.status === 'ready' && count < match.maxPlayers && match.autoReady === true) {
    await db.collection('matches').doc(matchId).update({ data: { status: 'registration_r2', autoReady: false } }).catch(() => {})
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action, matchId } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user || user.role !== 'admin') throw new Error('admins only')

  // ── status update ──────────────────────────────────────────────────────────
  if (!action || action === 'setStatus') {
    const { status } = event
    if (!VALID_STATUSES.includes(status)) throw new Error('invalid status')

    const matchSnap = await db.collection('matches').doc(matchId).get()
    const match = matchSnap.data
    if (!match) throw new Error('match not found')

    const updateData = { status, autoReady: false }

    // Initialize draftState when entering drafting
    let newDraftState = null
    if (status === 'drafting' && match.status !== 'drafting') {
      if (!match.captainA || !match.captainB) throw new Error('captains required before drafting')
      // Assign captains to their teams immediately
      const capAReg = matchId + '_' + match.captainA
      const capBReg = matchId + '_' + match.captainB
      await db.collection('registrations').doc(capAReg).update({ data: { team: 'A' } }).catch(() => {})
      await db.collection('registrations').doc(capBReg).update({ data: { team: 'B' } }).catch(() => {})
      // Count remaining picks (confirmed/promoted minus captains)
      const remainingSnap = await db.collection('registrations')
        .where({ matchId, status: _.in(['confirmed', 'promoted']), uid: _.nin([match.captainA, match.captainB]) })
        .count().catch(() => ({ total: 0 }))
      const remaining = remainingSnap.total ?? 0
      newDraftState = {
        pickOrder: buildPickOrder(remaining),
        pickIndex: 0,
        currentTurn: 'A',
      }
    }

    if (newDraftState) {
      // CloudBase can't set sub-fields when parent is null; first remove, then re-set.
      await db.collection('matches').doc(matchId).update({ data: { draftState: _.remove() } }).catch(() => {})
      updateData.draftState = newDraftState
    }
    await db.collection('matches').doc(matchId).update({ data: updateData })

    // Notify confirmed/promoted players if match was cancelled
    if (status === 'cancelled' && match.status !== 'cancelled') {
      const reason = (event.reason || '因故取消').toString().slice(0, 20)
      const d = new Date(match.date)
      const mdParts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(d)
      const get = (t) => mdParts.find(p => p.type === t)?.value || ''
      const matchName = `${get('month')}月${get('day')}日 ${get('hour')}:${get('minute')} 比赛`
      const regsSnap = await db.collection('registrations')
        .where({ matchId, status: _.in(['confirmed', 'promoted', 'waitlist']) })
        .get().catch(() => ({ data: [] }))
      for (const reg of regsSnap.data) {
        const uSnap = await db.collection('users').doc(reg.uid).get().catch(() => ({ data: null }))
        if (!uSnap.data?.openid) continue
        try {
          await cloud.callFunction({
            name: 'sendSubscribeMsg',
            data: {
              type: 'matchCancelled',
              toOpenid: uSnap.data.openid,
              data: {
                page: `/pages/match-detail/index?id=${matchId}`,
                templateData: {
                  thing1: { value: matchName.slice(0, 20) },
                  thing3: { value: reason },
                  thing4: { value: '下次见，敬请关注后续安排' },
                },
              },
            },
          })
        } catch (_) {}
      }
    }

    // Guard against double-counting: only on the first transition to completed
    // (a repeat setStatus('completed') or a race with the cron must be a no-op).
    if (status === 'completed' && match.status !== 'completed') {
      // Attendance for players who actually held a spot (promoted-but-unconfirmed excluded)
      const regsSnap = await db.collection('registrations')
        .where({ matchId, status: 'confirmed' })
        .get().catch(() => ({ data: [] }))
      for (const reg of regsSnap.data) {
        await db.collection('users').doc(reg.uid).update({
          data: { attendanceCount: _.inc(1) },
        }).catch(() => {})
      }
      // A completed match counts toward every active ban — banned players can't
      // register, so the ban must tick down for non-attendees.
      await db.collection('users')
        .where({ banGamesLeft: _.gt(0) })
        .update({ data: { banGamesLeft: _.inc(-1) } })
        .catch(() => {})
    }

    return { success: true }
  }

  // ── edit match details ─────────────────────────────────────────────────────
  if (action === 'editMatch') {
    const matchSnap = await db.collection('matches').doc(matchId).get()
    if (!matchSnap.data) throw new Error('match not found')
    if (['completed', 'cancelled'].includes(matchSnap.data.status)) throw new Error('比赛已结束，无法编辑')

    const update = {}
    if (typeof event.location === 'string' && event.location.trim()) update.location = event.location.trim()
    if (event.maxPlayers !== undefined) {
      const n = parseInt(event.maxPlayers, 10)
      if (isNaN(n) || n < 2 || n > 99) throw new Error('invalid maxPlayers')
      update.maxPlayers = n
    }
    if (event.dateStr) update.date = etTimestamp(event.dateStr, event.timeStr)
    else if (typeof event.date === 'number') update.date = event.date
    if (Object.keys(update).length === 0) throw new Error('nothing to update')

    await db.collection('matches').doc(matchId).update({ data: update })
    if (update.maxPlayers !== undefined) await recalcMatchState(matchId)
    return { success: true }
  }

  // ── record final score ─────────────────────────────────────────────────────
  if (action === 'setScore') {
    const scoreA = parseInt(event.scoreA, 10)
    const scoreB = parseInt(event.scoreB, 10)
    if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0 || scoreA > 99 || scoreB > 99) {
      throw new Error('invalid score')
    }
    const matchSnap = await db.collection('matches').doc(matchId).get()
    if (!matchSnap.data) throw new Error('match not found')
    if (!['ready', 'completed'].includes(matchSnap.data.status)) throw new Error('比赛未开始，无法记录比分')
    await db.collection('matches').doc(matchId).update({ data: { scoreA, scoreB } })
    return { success: true }
  }

  // ── per-player goals/assists ───────────────────────────────────────────────
  if (action === 'setStat') {
    const { uid } = event
    const goals = parseInt(event.goals, 10)
    const assists = parseInt(event.assists, 10)
    if (isNaN(goals) || isNaN(assists) || goals < 0 || assists < 0 || goals > 99 || assists > 99) {
      throw new Error('invalid stat')
    }
    const regId = matchId + '_' + uid
    const regSnap = await db.collection('registrations').doc(regId).get().catch(() => ({ data: null }))
    if (!regSnap.data || !['confirmed', 'promoted'].includes(regSnap.data.status)) {
      throw new Error('player not in roster')
    }
    await db.collection('registrations').doc(regId).update({ data: { goals, assists } })
    return { success: true }
  }

  // ── assign player to team ──────────────────────────────────────────────────
  if (action === 'assignTeam') {
    const { uid, team } = event
    const regId = matchId + '_' + uid
    await db.collection('registrations').doc(regId).update({ data: { team: team ?? null } })
    return { success: true }
  }

  // ── toggle late/dangerous/absent tag ──────────────────────────────────────
  if (action === 'toggleTag') {
    const { uid, tags } = event
    const regId = matchId + '_' + uid
    const regSnap = await db.collection('registrations').doc(regId).get()
    const oldTags = regSnap.data?.tags ?? []
    const newTags = tags ?? []

    const hadLate      = oldTags.includes('late')
    const hasLate      = newTags.includes('late')
    const hadDangerous = oldTags.includes('dangerous')
    const hasDangerous = newTags.includes('dangerous')
    const hadAbsent    = oldTags.includes('absent')
    const hasAbsent    = newTags.includes('absent')

    await db.collection('registrations').doc(regId).update({ data: { tags: newTags } })

    if (hadLate !== hasLate) {
      await db.collection('users').doc(uid).update({ data: { lateCount: _.inc(hasLate ? 1 : -1) } })
    }
    if (hadDangerous !== hasDangerous) {
      await db.collection('users').doc(uid).update({ data: { dangerousCount: _.inc(hasDangerous ? 1 : -1) } })
    }
    if (hadAbsent !== hasAbsent) {
      const uSnap = await db.collection('users').doc(uid).get().catch(() => ({ data: null }))
      if (uSnap.data) {
        const current = uSnap.data.banGamesLeft ?? 0
        const delta = hasAbsent ? 4 : -4
        const newBan = Math.max(0, current + delta)
        const newAbsentCount = Math.max(0, (uSnap.data.absentCount ?? 0) + (hasAbsent ? 1 : -1))
        await db.collection('users').doc(uid).update({
          data: { banGamesLeft: newBan, absentCount: newAbsentCount },
        })
      }
    }
    return { success: true }
  }

  // ── set captain ────────────────────────────────────────────────────────────
  if (action === 'setCaptain') {
    const { slot, uid } = event
    if (slot !== 'captainA' && slot !== 'captainB') throw new Error('invalid slot')

    const matchSnap = await db.collection('matches').doc(matchId).get()
    const matchDoc = matchSnap.data
    if (!matchDoc) throw new Error('match not found')

    if (uid) {
      const otherSlot = slot === 'captainA' ? 'captainB' : 'captainA'
      if (matchDoc[otherSlot] === uid) {
        throw new Error('一个人不能同时担任两边队长')
      }
      const regSnap = await db.collection('registrations').doc(matchId + '_' + uid).get().catch(() => ({ data: null }))
      if (!regSnap.data || !['confirmed', 'promoted'].includes(regSnap.data.status)) {
        throw new Error('captain must be a confirmed player')
      }
    }

    const prevUid = matchDoc[slot]
    if (prevUid && prevUid !== uid) {
      const prevRegId = matchId + '_' + prevUid
      await db.collection('registrations').doc(prevRegId).update({ data: { team: null } }).catch(() => {})
    }
    await db.collection('matches').doc(matchId).update({ data: { [slot]: uid ?? null } })
    if (uid) {
      const team = slot === 'captainA' ? 'A' : 'B'
      const regId = matchId + '_' + uid
      await db.collection('registrations').doc(regId).update({ data: { team } })
    }
    return { success: true }
  }

  throw new Error('unknown action: ' + action)
}
