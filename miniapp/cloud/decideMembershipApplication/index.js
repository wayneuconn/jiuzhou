const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const callerSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = callerSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const { appId, decision } = event
  if (!appId || !['approved', 'rejected'].includes(decision)) throw new Error('invalid params')
  const rejectReason = decision === 'rejected'
    ? (event.reason || '').toString().trim().slice(0, 50) || null
    : null

  const appSnap = await db.collection('membershipApplications').doc(appId).get().catch(() => ({ data: null }))
  const application = appSnap.data
  if (!application) throw new Error('application not found')
  if (application.status !== 'pending') throw new Error('该申请已被处理')

  await db.collection('membershipApplications').doc(appId).update({
    data: {
      status: decision,
      decidedBy: caller._id,
      decidedAt: db.serverDate(),
      rejectReason,
    },
  })

  // Approval is the only thing that actually changes membership — a 次卡
  // player applying for 年卡 stays 次卡 until an admin explicitly approves.
  if (decision === 'approved') {
    await db.collection('users').doc(application.uid).update({
      data: { membershipType: application.requestedType },
    })
  }

  return { success: true }
}
