const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { displayName, preferredPositions } = event

  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
    throw new Error('displayName required')
  }

  const existing = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const profileData = {
    displayName: displayName.trim(),
    preferredPositions: Array.isArray(preferredPositions) ? preferredPositions : [],
  }
  if (existing.data.length > 0) {
    await db.collection('users').where({ openid: OPENID }).update({ data: profileData })
  } else {
    await db.collection('users').add({
      data: {
        openid: OPENID,
        phone: '',
        role: 'guest',
        membershipType: 'none',
        attendanceCount: 0,
        lateCount: 0,
        dangerousCount: 0,
        createdAt: db.serverDate(),
        ...profileData,
      },
    })
  }
  return { success: true }
}
