const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { displayName, preferredPositions } = event

  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
    throw new Error('displayName required')
  }

  await db.collection('users').where({ openid: OPENID }).update({
    data: {
      displayName: displayName.trim(),
      preferredPositions: Array.isArray(preferredPositions) ? preferredPositions : [],
    },
  })

  return { success: true }
}
