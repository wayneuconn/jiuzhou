const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const VALID_STATUSES = ['draft', 'registration_r1', 'registration_r2', 'drafting', 'ready', 'completed', 'cancelled']

// Build the snake draft pick order: A, B, B, A, A, B, B, A …
// Captain A and B are auto-assigned to their teams before pick #1.
function buildPickOrder(remainingCount) {
  const order = []
  let team = 'A', n = 0
  for (let i = 0; i < remainingCount; i++) {
    order.push(team)
    n++
    if (n === 2) { team = team === 'A' ? 'B' : 'A'; n = 0 }
  }
  return order
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

    if (status === 'completed') {
      const regsSnap = await db.collection('registrations')
        .where({ matchId, status: _.in(['confirmed', 'promoted']) })
        .get().catch(() => ({ data: [] }))

      const attendees = regsSnap.data
      for (const reg of attendees) {
        const uSnap = await db.collection('users').doc(reg.uid).get().catch(() => ({ data: null }))
        if (!uSnap.data) continue
        const u = uSnap.data
        const newAttendance = (u.attendanceCount ?? 0) + 1
        const newBan = Math.max(0, (u.banGamesLeft ?? 0) - 1)
        await db.collection('users').doc(reg.uid).update({
          data: { attendanceCount: newAttendance, banGamesLeft: newBan },
        }).catch(() => {})
      }
    }

    return { success: true }
  }

  // ── assign player to team ──────────────────────────────────────────────────
  if (action === 'assignTeam') {
    const { uid, team } = event
    const regId = matchId + '_' + uid
    await db.collection('registrations').doc(regId).update({ data: { team: team ?? null } })
    return { success: true }
  }

  // ── toggle late/dangerous tag ──────────────────────────────────────────────
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

    await db.collection('registrations').doc(regId).update({ data: { tags: newTags } })

    if (hadLate !== hasLate) {
      await db.collection('users').doc(uid).update({ data: { lateCount: _.inc(hasLate ? 1 : -1) } })
    }
    if (hadDangerous !== hasDangerous) {
      await db.collection('users').doc(uid).update({ data: { dangerousCount: _.inc(hasDangerous ? 1 : -1) } })
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
