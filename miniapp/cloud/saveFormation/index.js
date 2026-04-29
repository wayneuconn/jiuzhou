const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId, positions } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('user not found')

  const matchSnap = await db.collection('matches').doc(matchId).get()
  const match = matchSnap.data
  if (!match) throw new Error('match not found')

  const isCaptain = user._id === match.captainA || user._id === match.captainB
  if (!isCaptain && user.role !== 'admin') throw new Error('captain or admin only')

  const team = user._id === match.captainA ? 'A' : 'B'
  const formationRef = db.collection('matches').doc(matchId).collection('formations').doc(team)

  await formationRef.set({
    data: {
      captainUid: user._id,
      positions,
      updatedAt: db.serverDate(),
    },
  })

  return { success: true }
}
