const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()

  if (userSnap.data.length > 0) {
    return { openid: OPENID, user: userSnap.data[0] }
  }
  // No record — caller redirects to onboarding; record is created on first updateProfile
  return { openid: OPENID, user: null }
}
