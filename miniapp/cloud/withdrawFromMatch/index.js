const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function nextWaitlistPosition(matchId) {
  const snap = await db.collection('registrations')
    .where({ matchId, status: 'waitlist' })
    .orderBy('waitlistPosition', 'desc')
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))
  return (snap.data[0]?.waitlistPosition ?? 0) + 1
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

// Fill free slots from the waitlist by (tier, position). During R1 only
// annual (tier 1) waiters may come in — friends and 次卡 wait for R2.
async function promoteFromWaitlist(matchId) {
  const matchSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
  const match = matchSnap.data
  if (!match) return
  if (!['registration_r1', 'registration_r2', 'ready'].includes(match.status)) return
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
            thing6: { value: isGuestNotice ? '你带的朋友已递补进名单' : `请在 ${waitlistMinutes} 分钟内确认报名` },
          },
        },
      },
    })
  } catch (_) {}
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId, mode } = event
  const newStatus = mode === 'excuse' ? 'excused' : 'withdrawn'

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('user not found')

  const matchSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
  const match = matchSnap.data
  if (!match) throw new Error('match not found')
  if (match.status === 'completed' || match.status === 'cancelled') {
    throw new Error('比赛已结束，无法退出')
  }

  // ── remove a friend I brought (or any guest, if admin) ─────────────────────
  if (event.friendUid) {
    const fRegId = matchId + '_' + event.friendUid
    const fSnap = await db.collection('registrations').doc(fRegId).get().catch(() => ({ data: null }))
    if (!fSnap.data || !fSnap.data.isGuest) throw new Error('friend registration not found')
    if (fSnap.data.broughtBy !== user._id && user.role !== 'admin') {
      throw new Error('只能移除自己带的朋友')
    }
    const freedSlot = ['confirmed', 'promoted'].includes(fSnap.data.status)
    await db.collection('registrations').doc(fRegId).update({
      data: { status: 'withdrawn', waitlistPosition: null, promotedAt: null, confirmDeadline: null, team: null },
    })
    if (freedSlot) await promoteFromWaitlist(matchId)
    else await recalcMatchState(matchId)
    return { success: true }
  }

  const regId = matchId + '_' + user._id
  const regSnap = await db.collection('registrations').doc(regId).get().catch(() => ({ data: null }))
  if (!regSnap.data) throw new Error('registration not found')

  const wasConfirmed = ['confirmed', 'promoted'].includes(regSnap.data.status)

  await db.collection('registrations').doc(regId).update({
    data: { status: newStatus, waitlistPosition: null, promotedAt: null, confirmDeadline: null, team: null },
  })

  // If they were a captain, clear that slot
  const clearData = {}
  if (match.captainA === user._id) clearData.captainA = null
  if (match.captainB === user._id) clearData.captainB = null
  if (Object.keys(clearData).length > 0) {
    // If currently drafting, also reset draftState (drafting cannot proceed without both captains)
    if (match.status === 'drafting') {
      clearData.status = 'registration_r2'
      clearData.draftState = null
    }
    await db.collection('matches').doc(matchId).update({ data: clearData }).catch(() => {})
  } else if (match.status === 'drafting') {
    // A non-captain left mid-draft; if no unassigned players remain, the draft is done.
    const unassignedSnap = await db.collection('registrations')
      .where({ matchId, status: _.in(['confirmed', 'promoted']), team: null })
      .count().catch(() => ({ total: 0 }))
    if ((unassignedSnap.total ?? 0) === 0) {
      await db.collection('matches').doc(matchId).update({
        data: { status: 'ready', autoReady: true, 'draftState.currentTurn': null },
      }).catch(() => {})
    }
  }

  // The bringer left — their friends lose the tier-2 privilege and re-queue
  // as ordinary tier-3 waiters (a confirmed friend gives the slot back; the
  // flush below re-fills it by priority, which may re-admit the friend if
  // nobody outranks them).
  const friendsSnap = await db.collection('registrations')
    .where({ matchId, broughtBy: user._id, isGuest: true, status: _.in(['confirmed', 'promoted', 'waitlist']) })
    .get().catch(() => ({ data: [] }))
  let friendFreedSlot = false
  for (const f of friendsSnap.data) {
    if (['confirmed', 'promoted'].includes(f.status)) friendFreedSlot = true
    const pos = await nextWaitlistPosition(matchId)
    await db.collection('registrations').doc(f._id).update({
      data: {
        status: 'waitlist',
        waitlistTier: 3,
        waitlistPosition: pos,
        promotedAt: null,
        confirmDeadline: null,
        team: null,
      },
    }).catch(() => {})
  }

  if (wasConfirmed || friendFreedSlot) await promoteFromWaitlist(matchId)
  else await recalcMatchState(matchId)
  return { success: true }
}
