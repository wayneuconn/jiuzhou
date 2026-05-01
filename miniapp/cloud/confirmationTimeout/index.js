const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const now = new Date()

  const configSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const waitlistMinutes = configSnap.data?.waitlistConfirmMinutes ?? 30

  const expiredSnap = await db.collection('registrations')
    .where({ status: 'promoted', confirmDeadline: _.lt(now) })
    .get()
    .catch(() => ({ data: [] }))

  if (expiredSnap.data.length === 0) return { processed: 0 }

  let processed = 0
  for (const expired of expiredSnap.data) {
    const { matchId, uid } = expired
    const regId = matchId + '_' + uid

    // Find next waitlisted player before re-queuing expired (so ordering is correct)
    const nextSnap = await db.collection('registrations')
      .where({ matchId, status: 'waitlist' })
      .orderBy('waitlistPosition', 'asc')
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))

    // Re-queue expired player at the back
    const wlCountSnap = await db.collection('registrations')
      .where({ matchId, status: 'waitlist' })
      .count()
      .catch(() => ({ total: 0 }))
    const backPosition = (wlCountSnap.total ?? 0) + 1

    await db.collection('registrations').doc(regId).update({
      data: { status: 'waitlist', promotedAt: null, confirmDeadline: null, waitlistPosition: backPosition },
    }).catch(() => {})

    if (nextSnap.data.length > 0) {
      const next = nextSnap.data[0]
      const nextRegId = matchId + '_' + next.uid
      if (next.autoAccept) {
        await db.collection('registrations').doc(nextRegId).update({
          data: { status: 'confirmed', waitlistPosition: null, promotedAt: null, confirmDeadline: null },
        }).catch(() => {})
      } else {
        const deadline = new Date(Date.now() + waitlistMinutes * 60 * 1000)
        await db.collection('registrations').doc(nextRegId).update({
          data: { status: 'promoted', promotedAt: db.serverDate(), confirmDeadline: deadline, waitlistPosition: null },
        }).catch(() => {})
        try {
          const userSnap = await db.collection('users').doc(next.uid).get()
          if (userSnap.data?.openid) {
            await cloud.callFunction({
              name: 'sendSubscribeMsg',
              data: { type: 'promoted', toOpenid: userSnap.data.openid, data: { page: `/pages/match-detail/index?id=${matchId}`, templateData: {} } },
            })
          }
        } catch (_) {}
      }
    }
    processed++
  }

  return { processed }
}
