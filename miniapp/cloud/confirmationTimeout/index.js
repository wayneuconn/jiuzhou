const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Timer trigger: runs every 5 minutes (configured in config.json)
exports.main = async (event, context) => {
  const now = new Date()

  const matchesSnap = await db.collection('matches')
    .where({ status: _.in(['registration_r1', 'registration_r2']) })
    .get()

  const configSnap = await db.collection('config').doc('app').get()
  const waitlistMinutes = configSnap.data?.waitlistConfirmMinutes ?? 30

  for (const match of matchesSnap.data) {
    const expiredSnap = await db.collection('matches').doc(match._id)
      .collection('registrations')
      .where({
        status: 'promoted',
        confirmDeadline: _.lt(now),
      })
      .get()

    for (const expired of expiredSnap.data) {
      // Expire this promotion — bump back to waitlist
      await db.collection('matches').doc(match._id)
        .collection('registrations').doc(expired._id)
        .update({
          data: {
            status: 'waitlist',
            promotedAt: null,
            confirmDeadline: null,
            waitlistPosition: 999,
          },
        })

      // Promote the next in line
      const nextSnap = await db.collection('matches').doc(match._id)
        .collection('registrations')
        .where({ status: 'waitlist' })
        .orderBy('waitlistPosition', 'asc')
        .limit(1)
        .get()

      if (nextSnap.data.length > 0) {
        const deadline = new Date(Date.now() + waitlistMinutes * 60 * 1000)
        await db.collection('matches').doc(match._id)
          .collection('registrations').doc(nextSnap.data[0]._id)
          .update({
            data: {
              status: 'promoted',
              promotedAt: db.serverDate(),
              confirmDeadline: deadline,
              waitlistPosition: null,
            },
          })
      }
    }
  }

  return { processed: matchesSnap.data.length }
}
