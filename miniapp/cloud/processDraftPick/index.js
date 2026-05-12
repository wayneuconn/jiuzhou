const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId, pickedUid } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const callerUid = userSnap.data[0]?._id
  if (!callerUid) throw new Error('user not found')

  const matchSnap = await db.collection('matches').doc(matchId).get()
  const match = matchSnap.data
  if (!match) throw new Error('match not found')
  if (match.status !== 'drafting') throw new Error('draft not active')

  const team = callerUid === match.captainA ? 'A' : callerUid === match.captainB ? 'B' : null
  if (!team) throw new Error('captains only')

  const draftState = match.draftState || {}
  if (draftState.currentTurn && draftState.currentTurn !== team) {
    throw new Error('not your turn')
  }

  // Verify pickedUid is unassigned + confirmed
  const pickedRegSnap = await db.collection('registrations').doc(matchId + '_' + pickedUid).get().catch(() => ({ data: null }))
  if (!pickedRegSnap.data || !['confirmed', 'promoted'].includes(pickedRegSnap.data.status)) {
    throw new Error('player not in roster')
  }
  if (pickedRegSnap.data.team) throw new Error('player already assigned')

  await db.collection('registrations').doc(matchId + '_' + pickedUid).update({ data: { team } })

  const nextIndex = (draftState.pickIndex ?? 0) + 1
  const pickOrder = draftState.pickOrder || []
  const nextTurn = nextIndex < pickOrder.length ? pickOrder[nextIndex] : null

  await db.collection('matches').doc(matchId).update({
    data: {
      'draftState.pickIndex': nextIndex,
      'draftState.currentTurn': nextTurn,
    },
  })

  // If draft is complete, the timer / admin can advance to ready manually,
  // or we can auto-advance here.
  if (nextTurn === null) {
    await db.collection('matches').doc(matchId).update({ data: { status: 'ready', autoReady: true } }).catch(() => {})
  }

  return { success: true, nextTurn, team }
}
