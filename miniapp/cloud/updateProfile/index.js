const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
    // Keep rosters in sync — registrations snapshot displayName/positions at
    // signup and would otherwise show the old name forever.
    await db.collection('registrations')
      .where({ uid: existing.data[0]._id, status: _.neq('withdrawn') })
      .update({ data: profileData })
      .catch(() => {})
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
