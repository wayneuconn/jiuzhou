// Handles withdrawal + immediate waitlist promotion in one call.
// Replaces the Firebase Firestore trigger (promoteFromWaitlist).
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

  const regRef = db.collection('matches').doc(matchId).collection('registrations').doc(user._id)
  const regSnap = await regRef.get()
  if (!regSnap.data) throw new Error('registration not found')

  const wasConfirmed = ['confirmed', 'promoted'].includes(regSnap.data.status)

  await regRef.update({ data: { status: 'withdrawn' } })

  if (!wasConfirmed) return { success: true }

  // Promote top waitlisted player
  const configSnap = await db.collection('config').doc('app').get()
  const waitlistMinutes = configSnap.data?.waitlistConfirmMinutes ?? 30

  const waitlistSnap = await db.collection('matches').doc(matchId)
    .collection('registrations')
    .where({ status: 'waitlist' })
    .orderBy('waitlistPosition', 'asc')
    .limit(1)
    .get()

  if (waitlistSnap.data.length === 0) return { success: true }

  const topWaiter = waitlistSnap.data[0]
  const deadline = new Date(Date.now() + waitlistMinutes * 60 * 1000)

  await db.collection('matches').doc(matchId).collection('registrations').doc(topWaiter._id).update({
    data: {
      status: 'promoted',
      promotedAt: db.serverDate(),
      confirmDeadline: deadline,
      waitlistPosition: null,
    },
  })

  return { success: true, promoted: topWaiter.uid }
}
