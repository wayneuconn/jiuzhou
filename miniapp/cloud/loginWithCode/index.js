const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()

  if (userSnap.data.length > 0) {
    return { openid: OPENID, user: userSnap.data[0] }
  }

  // First time — create a skeleton user doc, wait for phone binding
  await db.collection('users').add({
    data: {
      openid: OPENID,
      displayName: '',
      phone: '',
      preferredPositions: [],
      role: 'guest',
      membershipType: 'none',
      attendanceCount: 0,
      lateCount: 0,
      dangerousCount: 0,
      createdAt: db.serverDate(),
    },
  })

  const newSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  return { openid: OPENID, user: newSnap.data[0] }
}
