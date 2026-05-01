const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('user not found')

  const regId = matchId + '_' + user._id
  const regSnap = await db.collection('registrations').doc(regId).get().catch(() => ({ data: null }))
  if (!regSnap.data) throw new Error('registration not found')

  const wasConfirmed = ['confirmed', 'promoted'].includes(regSnap.data.status)

  await db.collection('registrations').doc(regId).update({ data: { status: 'withdrawn' } })

  if (!wasConfirmed) return { success: true }

  // Promote top waitlisted player
  const configSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const waitlistMinutes = configSnap.data?.waitlistConfirmMinutes ?? 30

  const waitlistSnap = await db.collection('registrations')
    .where({ matchId, status: 'waitlist' })
    .orderBy('waitlistPosition', 'asc')
    .limit(1)
    .get()

  if (waitlistSnap.data.length === 0) return { success: true }

  const topWaiter = waitlistSnap.data[0]
  const topWaiterId = matchId + '_' + topWaiter.uid

  if (topWaiter.autoAccept) {
    await db.collection('registrations').doc(topWaiterId).update({
      data: { status: 'confirmed', waitlistPosition: null, promotedAt: null, confirmDeadline: null },
    })
  } else {
    const deadline = new Date(Date.now() + waitlistMinutes * 60 * 1000)
    await db.collection('registrations').doc(topWaiterId).update({
      data: { status: 'promoted', promotedAt: db.serverDate(), confirmDeadline: deadline, waitlistPosition: null },
    })
    try {
      const waiterUserSnap = await db.collection('users').doc(topWaiter.uid).get()
      if (waiterUserSnap.data?.openid) {
        await cloud.callFunction({
          name: 'sendSubscribeMsg',
          data: {
            type: 'promoted',
            toOpenid: waiterUserSnap.data.openid,
            data: { page: `/pages/match-detail/index?id=${matchId}`, templateData: {} },
          },
        })
      }
    } catch (_) {}
  }

  return { success: true, promoted: topWaiter.uid }
}
