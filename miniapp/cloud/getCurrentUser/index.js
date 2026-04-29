const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const snap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  return { user: snap.data[0] ?? null }
}
