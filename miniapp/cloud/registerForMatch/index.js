const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId } = event

  const [userSnap, matchSnap, confirmedSnap] = await Promise.all([
    db.collection('users').where({ openid: OPENID }).limit(1).get(),
    db.collection('matches').doc(matchId).get(),
    db.collection('registrations')
      .where({ matchId, status: _.in(['confirmed', 'promoted']) })
      .count(),
  ])

  const user = userSnap.data[0]
  const match = matchSnap.data

  if (!user || !match) throw new Error('user or match not found')
  if (!['registration_r1', 'registration_r2'].includes(match.status)) {
    throw new Error('registration not open')
  }
  if (match.status === 'registration_r1' && user.membershipType === 'none') {
    throw new Error('r1 members only')
  }

  const regId = matchId + '_' + user._id
  const existingSnap = await db.collection('registrations').doc(regId).get().catch(() => ({ data: null }))

  if (existingSnap.data) {
    if (['confirmed', 'promoted', 'waitlist'].includes(existingSnap.data.status)) {
      throw new Error('already registered')
    }
    // Re-register after withdrawal/excused
    await db.collection('registrations').doc(regId).update({
      data: { status: 'confirmed', registeredAt: db.serverDate(), tags: [] },
    })
    return { status: 'confirmed' }
  }

  const confirmedCount = confirmedSnap.total ?? 0
  const isWaitlist = confirmedCount >= match.maxPlayers

  let waitlistPosition = null
  if (isWaitlist) {
    const wlSnap = await db.collection('registrations')
      .where({ matchId, status: 'waitlist' })
      .count()
    waitlistPosition = (wlSnap.total ?? 0) + 1
  }

  await db.collection('registrations').doc(regId).set({
    data: {
      matchId,
      uid: user._id,
      displayName: user.displayName,
      preferredPositions: user.preferredPositions ?? [],
      registeredAt: db.serverDate(),
      status: isWaitlist ? 'waitlist' : 'confirmed',
      waitlistPosition: isWaitlist ? waitlistPosition : null,
      team: null,
      tags: [],
      autoAccept: event.autoAccept !== undefined ? event.autoAccept : true,
    },
  })

  return { status: isWaitlist ? 'waitlist' : 'confirmed' }
}
