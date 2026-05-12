const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Auto state machine helper — call after any registration change.
// R1/R2 + confirmed === maxPlayers → ready (autoReady: true)
// ready + confirmed < maxPlayers + autoReady === true → registration_r2 (autoReady: false)
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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId, mode } = event
  const newStatus = mode === 'excuse' ? 'excused' : 'withdrawn'

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('user not found')

  const regId = matchId + '_' + user._id
  const regSnap = await db.collection('registrations').doc(regId).get().catch(() => ({ data: null }))
  if (!regSnap.data) throw new Error('registration not found')

  const wasConfirmed = ['confirmed', 'promoted'].includes(regSnap.data.status)

  await db.collection('registrations').doc(regId).update({ data: { status: newStatus, waitlistPosition: null, promotedAt: null, confirmDeadline: null } })

  // If they were a captain, clear that slot
  const matchSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
  const match = matchSnap.data
  if (match) {
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
    }
  }

  if (!wasConfirmed) {
    await recalcMatchState(matchId)
    return { success: true }
  }

  // Promote top waitlisted player
  const configSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const waitlistMinutes = configSnap.data?.waitlistConfirmMinutes ?? 30

  const waitlistSnap = await db.collection('registrations')
    .where({ matchId, status: 'waitlist' })
    .orderBy('waitlistPosition', 'asc')
    .limit(1)
    .get()

  if (waitlistSnap.data.length === 0) {
    await recalcMatchState(matchId)
    return { success: true }
  }

  const topWaiter = waitlistSnap.data[0]
  const topWaiterId = matchId + '_' + topWaiter.uid

  if (topWaiter.autoAccept) {
    await db.collection('registrations').doc(topWaiterId).update({
      data: { status: 'confirmed', waitlistPosition: null, promotedAt: null, confirmDeadline: null },
    })
  } else {
    const deadlineTs = Date.now() + waitlistMinutes * 60 * 1000
    await db.collection('registrations').doc(topWaiterId).update({
      data: { status: 'promoted', promotedAt: db.serverDate(), confirmDeadline: deadlineTs, waitlistPosition: null },
    })
    try {
      const waiterUserSnap = await db.collection('users').doc(topWaiter.uid).get()
      const matchSnap2 = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
      const m = matchSnap2.data
      if (waiterUserSnap.data?.openid && m) {
        const d = new Date(m.date)
        const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
        await cloud.callFunction({
          name: 'sendSubscribeMsg',
          data: {
            type: 'promoted',
            toOpenid: waiterUserSnap.data.openid,
            data: {
              page: `/pages/match-detail/index?id=${matchId}`,
              templateData: {
                thing2: { value: '九州足球比赛' },
                time4: { value: timeStr },
                thing5: { value: (m.location || '待定').slice(0, 20) },
                thing6: { value: `请在 ${waitlistMinutes} 分钟内确认报名` },
              },
            },
          },
        })
      }
    } catch (_) {}
  }

  await recalcMatchState(matchId)
  return { success: true, promoted: topWaiter.uid }
}
