const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Snake draft turn for pick #i (0-based): A, B, B, A, A, B, B, A …
// Must match buildPickOrder in updateMatchStatus.
function turnForPick(i) {
  if (i === 0) return 'A'
  return Math.floor((i - 1) / 2) % 2 === 0 ? 'B' : 'A'
}

exports.main = async (event) => {
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
  const curIndex = draftState.pickIndex ?? 0
  if (draftState.currentTurn && draftState.currentTurn !== team) {
    throw new Error('not your turn')
  }

  // Verify pickedUid is unassigned + confirmed
  const pickedRegSnap = await db.collection('registrations').doc(matchId + '_' + pickedUid).get().catch(() => ({ data: null }))
  if (!pickedRegSnap.data || !['confirmed', 'promoted'].includes(pickedRegSnap.data.status)) {
    throw new Error('player not in roster')
  }
  if (pickedRegSnap.data.team) throw new Error('player already assigned')

  // Optimistic lock: bump pickIndex only if it hasn't moved since we read it.
  // Blocks double-taps and simultaneous picks from both captains.
  const lock = await db.collection('matches')
    .where({ _id: matchId, status: 'drafting', 'draftState.pickIndex': curIndex })
    .update({ data: { 'draftState.pickIndex': _.inc(1) } })
  if (!lock.stats || lock.stats.updated === 0) {
    throw new Error('选人状态已变化，请刷新后重试')
  }

  await db.collection('registrations').doc(matchId + '_' + pickedUid).update({ data: { team } })

  // Completion is decided by the actual roster, not the pre-built pick order,
  // so mid-draft withdrawals/promotions can't strand the draft.
  const unassignedSnap = await db.collection('registrations')
    .where({ matchId, status: _.in(['confirmed', 'promoted']), team: null })
    .count().catch(() => ({ total: 0 }))
  const remaining = unassignedSnap.total ?? 0
  const nextIndex = curIndex + 1
  const nextTurn = remaining > 0 ? turnForPick(nextIndex) : null

  await db.collection('matches').doc(matchId).update({
    data: { 'draftState.currentTurn': nextTurn },
  })

  if (nextTurn === null) {
    await db.collection('matches').doc(matchId).update({ data: { status: 'ready', autoReady: true } }).catch(() => {})
  }

  return { success: true, nextTurn, team }
}
