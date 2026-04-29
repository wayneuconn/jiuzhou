const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { code } = event

  // Decode phone number using the fast-path API (getPhoneNumber component)
  const phoneRes = await cloud.openapi.phonenumber.getPhoneNumber({ code })
  const phone = phoneRes.phoneInfo.purePhoneNumber

  await db.collection('users').where({ openid: OPENID }).update({
    data: { phone },
  })

  return { success: true, phone }
}
