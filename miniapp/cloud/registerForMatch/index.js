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

// Next waitlist position: existing positions are never compacted, so use
// max(position)+1 rather than count+1 to avoid duplicates after promotions.
async function nextWaitlistPosition(matchId) {
  const snap = await db.collection('registrations')
    .where({ matchId, status: 'waitlist' })
    .orderBy('waitlistPosition', 'desc')
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))
  return (snap.data[0]?.waitlistPosition ?? 0) + 1
}

// Concurrent registrations can both pass the capacity pre-check. After
// confirming, recount; if the roster overshot maxPlayers and we are among the
// newest confirmations, demote ourselves back to the waitlist.
async function resolveOverflow(matchId, regId, maxPlayers) {
  const confirmedSnap = await db.collection('registrations')
    .where({ matchId, status: _.in(['confirmed', 'promoted']) })
    .count().catch(() => ({ total: 0 }))
  const total = confirmedSnap.total ?? 0
  if (total <= maxPlayers) return 'confirmed'

  const overflow = total - maxPlayers
  const newestSnap = await db.collection('registrations')
    .where({ matchId, status: 'confirmed' })
    .orderBy('registeredAt', 'desc')
    .limit(overflow)
    .get()
    .catch(() => ({ data: [] }))
  const amNewest = newestSnap.data.some(r => r._id === regId)
  if (!amNewest) return 'confirmed'

  const position = await nextWaitlistPosition(matchId)
  await db.collection('registrations').doc(regId).update({
    data: { status: 'waitlist', waitlistPosition: position },
  })
  return 'waitlist'
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
  if (match.status === 'registration_r1' && user.membershipType !== 'annual' && user.role !== 'admin') {
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
    // Re-register after withdrawal/excused — recheck capacity.
    // Behavior tags from this match are kept (user counters were already bumped).
    const reConfirmedCount = confirmedSnap.total ?? 0
    const reIsWaitlist = reConfirmedCount >= match.maxPlayers
    const reWaitlistPosition = reIsWaitlist ? await nextWaitlistPosition(matchId) : null
    const reAutoAccept = typeof event.autoAccept === 'boolean'
      ? event.autoAccept
      : (existingSnap.data.autoAccept ?? true)
    await db.collection('registrations').doc(regId).update({
      data: {
        status: reIsWaitlist ? 'waitlist' : 'confirmed',
        waitlistPosition: reWaitlistPosition,
        registeredAt: db.serverDate(),
        autoAccept: reAutoAccept,
      },
    })
    let reStatus = reIsWaitlist ? 'waitlist' : 'confirmed'
    if (!reIsWaitlist) reStatus = await resolveOverflow(matchId, regId, match.maxPlayers)
    await recalcMatchState(matchId)
    return { status: reStatus }
  }

  const confirmedCount = confirmedSnap.total ?? 0
  const isWaitlist = confirmedCount >= match.maxPlayers
  const waitlistPosition = isWaitlist ? await nextWaitlistPosition(matchId) : null

  await db.collection('registrations').doc(regId).set({
    data: {
      matchId,
      uid: user._id,
      displayName: user.displayName,
      preferredPositions: user.preferredPositions ?? [],
      registeredAt: db.serverDate(),
      status: isWaitlist ? 'waitlist' : 'confirmed',
      waitlistPosition,
      team: null,
      tags: [],
      autoAccept: typeof event.autoAccept === 'boolean' ? event.autoAccept : true,
    },
  })

  let status = isWaitlist ? 'waitlist' : 'confirmed'
  if (!isWaitlist) status = await resolveOverflow(matchId, regId, match.maxPlayers)
  await recalcMatchState(matchId)
  return { status }
}
