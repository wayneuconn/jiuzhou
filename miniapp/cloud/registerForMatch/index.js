const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
  if (match.status === 'registration_r1' && user.membershipType !== 'annual') {
    throw new Error('r1 annual members only')
  }
  if (user.banGamesLeft > 0) {
    throw new Error(`账号已被禁赛，还剩 ${user.banGamesLeft} 场`)
  }

  const regId = matchId + '_' + user._id
  const existingSnap = await db.collection('registrations').doc(regId).get().catch(() => ({ data: null }))

  if (existingSnap.data) {
    if (['confirmed', 'promoted', 'waitlist'].includes(existingSnap.data.status)) {
      throw new Error('already registered')
    }
    // Re-register after withdrawal/excused — recheck capacity
    const reConfirmedCount = confirmedSnap.total ?? 0
    const reIsWaitlist = reConfirmedCount >= match.maxPlayers
    let reWaitlistPosition = null
    if (reIsWaitlist) {
      const wlSnap = await db.collection('registrations').where({ matchId, status: 'waitlist' }).count()
      reWaitlistPosition = (wlSnap.total ?? 0) + 1
    }
    const reAutoAccept = typeof event.autoAccept === 'boolean'
      ? event.autoAccept
      : (existingSnap.data.autoAccept ?? true)
    await db.collection('registrations').doc(regId).update({
      data: {
        status: reIsWaitlist ? 'waitlist' : 'confirmed',
        waitlistPosition: reIsWaitlist ? reWaitlistPosition : null,
        registeredAt: db.serverDate(),
        tags: [],
        autoAccept: reAutoAccept,
      },
    })
    await recalcMatchState(matchId)
    return { status: reIsWaitlist ? 'waitlist' : 'confirmed' }
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
      autoAccept: typeof event.autoAccept === 'boolean' ? event.autoAccept : true,
    },
  })

  await recalcMatchState(matchId)
  return { status: isWaitlist ? 'waitlist' : 'confirmed' }
}
