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
  if (!Array.isArray(preferredPositions) || preferredPositions.length === 0) {
    throw new Error('请至少选择一个位置')
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
        // New users start unassigned — admins grant 次卡/年卡 manually in
        // 成员管理, or via the application flow.
        membershipType: 'none',
        attendanceCount: 0,
        lateCount: 0,
        lateCountTotal: 0,
        dangerousCount: 0,
        createdAt: db.serverDate(),
        ...profileData,
      },
    })
  }
  return { success: true }
}
