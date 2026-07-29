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
  // Full no longer auto-flips to ready — capacity checks in registerForMatch
  // keep the roster capped while the waitlist stays joinable (this also keeps
  // already-released frontends working: they close everything on 'ready').
  if (match.status === 'ready' && count < match.maxPlayers && match.autoReady === true) {
    await db.collection('matches').doc(matchId).update({ data: { status: 'registration_r2', autoReady: false } }).catch(() => {})
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('user not found')

  const regId = matchId + '_' + user._id
  const regSnap = await db.collection('registrations').doc(regId).get().catch(() => ({ data: null }))
  if (!regSnap.data || regSnap.data.status !== 'promoted') {
    throw new Error('not in promoted state')
  }

  await db.collection('registrations').doc(regId).update({
    data: { status: 'confirmed', promotedAt: null, confirmDeadline: null },
  })
  await recalcMatchState(matchId)
  return { success: true }
}
