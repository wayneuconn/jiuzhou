const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Match-day registration cutoff: 14:00 ET on the day of kickoff. After this,
// new signups queue for manual review and auto-promotion pauses — slots are
// filled only by captains/admins (bumpWaitlist).
function registrationCutoffTs(matchDate) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(matchDate))
  const y = Number(parts.find(p => p.type === 'year').value)
  const mo = Number(parts.find(p => p.type === 'month').value)
  const da = Number(parts.find(p => p.type === 'day').value)
  const utcBase = new Date(Date.UTC(y, mo - 1, da))
  return utcBase.getTime() + etOffsetMinutes(utcBase) * 60000 + 14 * 3600000
}

const VALID_STATUSES = ['draft', 'registration_r1', 'registration_r2', 'drafting', 'ready', 'completed', 'cancelled']

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
  // Full no longer auto-flips to ready — capacity checks in registerForMatch
  // keep the roster capped while the waitlist stays joinable (this also keeps
  // already-released frontends working: they close everything on 'ready').
  if (match.status === 'ready' && count < match.maxPlayers && match.autoReady === true) {
    await db.collection('matches').doc(matchId).update({ data: { status: 'registration_r2', autoReady: false } }).catch(() => {})
  }
}

// Fill free slots from the waitlist by (tier, position). During R1 only
// annual (tier 1) waiters may come in — friends and 次卡 wait for R2.
async function promoteFromWaitlist(matchId) {
  const matchSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
  const match = matchSnap.data
  if (!match) return
  if (!['registration_r1', 'registration_r2', 'ready'].includes(match.status)) return
  // After the match-day cutoff, slots are filled manually by captains/admins
  if (Date.now() >= registrationCutoffTs(match.date)) return
  const maxTier = match.status === 'registration_r1' ? 1 : 99

  const configSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const waitlistMinutes = configSnap.data?.waitlistConfirmMinutes ?? 30

  for (let guard = 0; guard < 50; guard++) {
    const cnt = await db.collection('registrations')
      .where({ matchId, status: _.in(['confirmed', 'promoted']) })
      .count().catch(() => ({ total: null }))
    if (cnt.total === null || cnt.total >= match.maxPlayers) break

    const waitSnap = await db.collection('registrations')
      .where({ matchId, status: 'waitlist' })
      .limit(100)
      .get()
      .catch(() => ({ data: [] }))
    const next = waitSnap.data
      .map(r => ({ ...r, _tier: r.waitlistTier ?? 1 }))
      .filter(r => r._tier <= maxTier)
      .sort((a, b) => a._tier - b._tier || (a.waitlistPosition ?? 99) - (b.waitlistPosition ?? 99))[0]
    if (!next) break

    const regId = next._id
    if (next.isGuest || next.autoAccept !== false) {
      await db.collection('registrations').doc(regId).update({
        data: { status: 'confirmed', waitlistPosition: null, promotedAt: null, confirmDeadline: null },
      }).catch(() => {})
      const notifyUid = next.isGuest ? next.broughtBy : null
      if (notifyUid) await notifyPromoted(matchId, match, notifyUid, waitlistMinutes, true)
    } else {
      const deadlineTs = Date.now() + waitlistMinutes * 60 * 1000
      await db.collection('registrations').doc(regId).update({
        data: { status: 'promoted', promotedAt: db.serverDate(), confirmDeadline: deadlineTs, waitlistPosition: null },
      }).catch(() => {})
      await notifyPromoted(matchId, match, next.uid, waitlistMinutes, false)
    }
  }
  await recalcMatchState(matchId)
}

// Registration-open broadcast: R1 → annual members, R2 → 次卡. Skips users
// already on the roster/waitlist; best-effort, consumes each user's banked
// one-time subscribe quota (活动开始通知 fields thing4/thing2/date5).
async function notifyMatchOpen(matchId, match, membershipType, text) {
  try {
    const [usersSnap, regsSnap] = await Promise.all([
      db.collection('users').where({ membershipType }).limit(200).get().catch(() => ({ data: [] })),
      db.collection('registrations')
        .where({ matchId, status: _.in(['confirmed', 'promoted', 'waitlist']) })
        .limit(100).get().catch(() => ({ data: [] })),
    ])
    const registered = new Set(regsSnap.data.map(r => r.uid))
    const d = new Date(match.date)
    const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
    await Promise.all(usersSnap.data
      .filter(u => u.openid && !registered.has(u._id))
      .map(u => cloud.callFunction({
        name: 'sendSubscribeMsg',
        data: {
          type: 'matchOpen',
          toOpenid: u.openid,
          data: {
            page: `/pages/match-detail/index?id=${matchId}`,
            templateData: {
              thing4: { value: text.slice(0, 20) },
              thing2: { value: (match.location || '待定').slice(0, 20) },
              date5: { value: timeStr },
            },
          },
        },
      }).catch(() => {})))
  } catch (_) {}
}

// A GK-penalty player who actually turned out gets their 迟到 tally wiped;
// both they and the admins are told. (活动开始通知: thing4/thing2/date5)
async function clearLatePenalties(matchId, match) {
  try {
    const regsSnap = await db.collection('registrations')
      .where({ matchId, status: 'confirmed', gkPenalty: true })
      .limit(100).get().catch(() => ({ data: [] }))
    if (regsSnap.data.length === 0) return
    const d = new Date(match.date)
    const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
    const adminsSnap = await db.collection('users').where({ role: 'admin' }).limit(50).get().catch(() => ({ data: [] }))

    for (const reg of regsSnap.data) {
      const uSnap = await db.collection('users').doc(reg.uid).get().catch(() => ({ data: null }))
      if (!uSnap.data) continue
      await db.collection('users').doc(reg.uid).update({ data: { lateCount: 0 } }).catch(() => {})
      const name = uSnap.data.displayName || '球员'
      const send = (openid, title, body) => cloud.callFunction({
        name: 'sendSubscribeMsg',
        data: {
          type: 'matchOpen',
          toOpenid: openid,
          data: {
            page: `/pages/match-detail/index?id=${matchId}`,
            templateData: {
              thing4: { value: title.slice(0, 20) },
              thing2: { value: body.slice(0, 20) },
              date5: { value: timeStr },
            },
          },
        },
      }).catch(() => {})
      if (uSnap.data.openid) await send(uSnap.data.openid, '迟到记录已清零', '感谢准时出席本场')
      for (const admin of adminsSnap.data) {
        if (admin.openid) await send(admin.openid, `${name} 迟到记录已清零`, '已完成门将场次')
      }
    }
  } catch (_) {}
}

async function notifyPromoted(matchId, match, uid, waitlistMinutes, isGuestNotice) {
  try {
    const uSnap = await db.collection('users').doc(uid).get().catch(() => ({ data: null }))
    if (!uSnap.data?.openid) return
    const d = new Date(match.date)
    const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
    await cloud.callFunction({
      name: 'sendSubscribeMsg',
      data: {
        type: 'promoted',
        toOpenid: uSnap.data.openid,
        data: {
          page: `/pages/match-detail/index?id=${matchId}`,
          templateData: {
            thing2: { value: '九州足球比赛' },
            time4: { value: timeStr },
            thing5: { value: (match.location || '待定').slice(0, 20) },
            thing6: { value: isGuestNotice ? '朋友已递补进名单,请联系管理员确认' : `请在 ${waitlistMinutes} 分钟内确认报名` },
          },
        },
      },
    })
  } catch (_) {}
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action, matchId } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('user not found')
  const isAdmin = user.role === 'admin'
  // Non-admins may only attempt the captain-scoped actions (each validated
  // below against THIS match's captains); everything else is admin-only.
  const CAPTAIN_ACTIONS = ['setStatus', 'bumpWaitlist', 'setScore', 'setStat']
  if (!isAdmin && action && !CAPTAIN_ACTIONS.includes(action)) {
    throw new Error('admins only')
  }
  async function assertCaptain(mId) {
    const mSnap = await db.collection('matches').doc(mId).get().catch(() => ({ data: null }))
    const m = mSnap.data
    if (!m || (m.captainA !== user._id && m.captainB !== user._id)) {
      throw new Error('仅管理员或本场队长可操作')
    }
  }

  // ── status update ──────────────────────────────────────────────────────────
  if (!action || action === 'setStatus') {
    const { status } = event
    if (!VALID_STATUSES.includes(status)) throw new Error('invalid status')

    const matchSnap = await db.collection('matches').doc(matchId).get()
    const match = matchSnap.data
    if (!match) throw new Error('match not found')

    if (!isAdmin) {
      // Captains of THIS match may start the draft from a registration phase
      // and end it (选人结束 → ready); nothing else.
      const isCaptain = user._id === match.captainA || user._id === match.captainB
      const draftKickoff = status === 'drafting'
        && isCaptain
        && ['registration_r1', 'registration_r2'].includes(match.status)
      const draftFinish = status === 'ready'
        && isCaptain
        && match.status === 'drafting'
      if (!draftKickoff && !draftFinish) throw new Error('admins only')
    }

    // rosterLocked is only set by the kickoff-1h cron; any manual status
    // change (incl. 选人结束) leaves the waitlist open for replacements.
    const updateData = { status, autoReady: false, rosterLocked: false }

    // Entering drafting: captains lock to their teams; picking itself is
    // free-for-all (no turn order), so no draftState is needed.
    if (status === 'drafting' && match.status !== 'drafting') {
      if (!match.captainA || !match.captainB) throw new Error('captains required before drafting')
      const capAReg = matchId + '_' + match.captainA
      const capBReg = matchId + '_' + match.captainB
      await db.collection('registrations').doc(capAReg).update({ data: { team: 'A' } }).catch(() => {})
      await db.collection('registrations').doc(capBReg).update({ data: { team: 'B' } }).catch(() => {})
      await db.collection('matches').doc(matchId).update({ data: { draftState: _.remove() } }).catch(() => {})
    }

    await db.collection('matches').doc(matchId).update({ data: updateData })

    // Opening R1: tell annual members a new match is up for registration
    if (status === 'registration_r1' && match.status === 'draft') {
      await notifyMatchOpen(matchId, match, 'annual', '新比赛开放报名(R1)')
    }

    // Opening R2 lifts the annual-only gate — drain the waitlist by priority,
    // then tell 次卡 members registration is open for them
    if (status === 'registration_r2' && match.status !== 'registration_r2') {
      await promoteFromWaitlist(matchId)
      await notifyMatchOpen(matchId, match, 'per_session', 'R2 全员报名已开放')
    }

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
      await clearLatePenalties(matchId, match)
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

  // ── record final score (admins or this match's captains) ──────────────────
  if (action === 'setScore') {
    if (!isAdmin) await assertCaptain(matchId)
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

  // ── per-player goals/assists (admins or this match's captains) ────────────
  if (action === 'setStat') {
    if (!isAdmin) await assertCaptain(matchId)
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

  // ── bump any waitlisted player straight into the roster ───────────────────
  // Admins anywhere; captains of THIS match too (post-cutoff manual review).
  if (action === 'bumpWaitlist') {
    if (!isAdmin) await assertCaptain(matchId)
    const { uid } = event
    const regId = matchId + '_' + uid
    const regSnap = await db.collection('registrations').doc(regId).get().catch(() => ({ data: null }))
    if (!regSnap.data || !['waitlist', 'promoted'].includes(regSnap.data.status)) {
      throw new Error('该球员不在候补名单中')
    }
    // Optional team lets the admin/captain fill a specific side in one tap
    const teamPatch = ['A', 'B'].includes(event.team) ? { team: event.team } : {}
    await db.collection('registrations').doc(regId).update({
      data: { status: 'confirmed', waitlistPosition: null, promotedAt: null, confirmDeadline: null, ...teamPatch },
    })
    await recalcMatchState(matchId)
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
      if (hasLate) {
        // Crossing the threshold means GK duty next match — flag it to admins
        const cfg = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
        const th = cfg.data?.lateThreshold ?? 0
        const uSnap = await db.collection('users').doc(uid).get().catch(() => ({ data: null }))
        const n = uSnap.data?.lateCount ?? 0
        if (th > 0 && n >= th) {
          const mSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
          const nm = uSnap.data?.displayName || '球员'
          const adminsSnap = await db.collection('users').where({ role: 'admin' }).limit(50).get().catch(() => ({ data: [] }))
          const d = new Date(mSnap.data?.date ?? Date.now())
          const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
          for (const admin of adminsSnap.data) {
            if (!admin.openid) continue
            await cloud.callFunction({
              name: 'sendSubscribeMsg',
              data: {
                type: 'adminAlert',
                toOpenid: admin.openid,
                data: {
                  page: `/pages/match-detail/index?id=${matchId}`,
                  templateData: {
                    thing4: { value: `${nm} 迟到已达 ${n} 次`.slice(0, 20) },
                    thing2: { value: '下一场需担任门将' },
                    date5: { value: timeStr },
                  },
                },
              },
            }).catch(() => {})
          }
        }
      }
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
