const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const VALID_STATUSES = ['draft', 'registration_r1', 'registration_r2', 'drafting', 'ready', 'completed', 'cancelled']

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId, status } = event

  if (!VALID_STATUSES.includes(status)) throw new Error('invalid status')

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user || user.role !== 'admin') throw new Error('admins only')

  await db.collection('matches').doc(matchId).update({ data: { status } })
  return { success: true }
}
