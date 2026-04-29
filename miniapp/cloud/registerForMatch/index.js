const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId } = event

  const [userSnap, matchSnap, regsSnap] = await Promise.all([
    db.collection('users').where({ openid: OPENID }).limit(1).get(),
    db.collection('matches').doc(matchId).get(),
    db.collection('matches').doc(matchId).collection('registrations')
      .where({ status: _.in(['confirmed', 'promoted']) }).get(),
  ])

  const user = userSnap.data[0]
  const match = matchSnap.data

  if (!user || !match) throw new Error('user or match not found')
  if (!['registration_r1', 'registration_r2'].includes(match.status)) {
    throw new Error('registration not open')
  }

  // r1: members only; r2: guests allowed
  if (match.status === 'registration_r1' && user.membershipType === 'none') {
    throw new Error('r1 members only')
  }

  const existing = await db.collection('matches').doc(matchId)
    .collection('registrations').doc(user._id).get().catch(() => null)

  if (existing?.data) {
    if (['confirmed', 'promoted', 'waitlist'].includes(existing.data.status)) {
      throw new Error('already registered')
    }
    // Re-register after withdrawal
    await db.collection('matches').doc(matchId).collection('registrations').doc(user._id).update({
      data: { status: 'confirmed', registeredAt: db.serverDate(), tags: [] },
    })
    return { status: 'confirmed' }
  }

  const confirmedCount = regsSnap.data.length
  const isWaitlist = confirmedCount >= match.maxPlayers

  const waitlistSnap = isWaitlist
    ? await db.collection('matches').doc(matchId).collection('registrations')
        .where({ status: 'waitlist' }).count()
    : null

  await db.collection('matches').doc(matchId).collection('registrations').doc(user._id).set({
    data: {
      uid: user._id,
      displayName: user.displayName,
      preferredPositions: user.preferredPositions ?? [],
      registeredAt: db.serverDate(),
      status: isWaitlist ? 'waitlist' : 'confirmed',
      waitlistPosition: isWaitlist ? (waitlistSnap?.total ?? 0) + 1 : null,
      team: null,
      tags: [],
    },
  })

  return { status: isWaitlist ? 'waitlist' : 'confirmed' }
}
