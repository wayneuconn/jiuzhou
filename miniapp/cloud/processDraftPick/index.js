const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId, pickedUid } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const callerUid = userSnap.data[0]?._id
  if (!callerUid) throw new Error('user not found')

  return db.runTransaction(async (transaction) => {
    const matchSnap = await transaction.get(db.collection('matches').doc(matchId))
    const match = matchSnap.data
    if (!match) throw new Error('match not found')
    if (match.status !== 'drafting') throw new Error('draft not active')

    const draftState = match.draftState
    if (callerUid !== draftState.currentTurn) throw new Error('not your turn')

    const team = callerUid === match.captainA ? 'A' : 'B'

    await db.collection('matches').doc(matchId)
      .collection('registrations').doc(pickedUid).update({ data: { team } })

    const picks = [...(draftState.picks || []), {
      uid: pickedUid,
      pickedBy: callerUid,
      pickNumber: (draftState.picks || []).length + 1,
    }]

    const nextIndex = picks.length
    const nextTurn = nextIndex < draftState.pickOrder.length
      ? draftState.pickOrder[nextIndex]
      : null

    transaction.update(db.collection('matches').doc(matchId), {
      data: {
        'draftState.picks': picks,
        'draftState.currentTurn': nextTurn,
      },
    })

    return { success: true, nextTurn }
  })
}
