const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { code } = event

  // Decode phone number using the fast-path API (getPhoneNumber component)
  const phoneRes = await cloud.openapi.phonenumber.getPhoneNumber({ code })
  const phone = phoneRes.phoneInfo.purePhoneNumber

  const existing = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  if (existing.data.length > 0) {
    await db.collection('users').where({ openid: OPENID }).update({ data: { phone } })
  } else {
    await db.collection('users').add({
      data: {
        openid: OPENID,
        phone,
        displayName: '',
        preferredPositions: [],
        role: 'guest',
        membershipType: 'none',
        attendanceCount: 0,
        lateCount: 0,
        dangerousCount: 0,
        createdAt: db.serverDate(),
      },
    })
  }
  return { success: true, phone }
}
