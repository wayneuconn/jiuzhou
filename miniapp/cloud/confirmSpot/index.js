const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('user not found')

  const regSnap = await db.collection('matches').doc(matchId)
    .collection('registrations').doc(user._id).get()

  if (!regSnap.data || regSnap.data.status !== 'promoted') {
    throw new Error('not in promoted state')
  }

  await db.collection('matches').doc(matchId)
    .collection('registrations').doc(user._id).update({
      data: { status: 'confirmed' },
    })

  return { success: true }
}
