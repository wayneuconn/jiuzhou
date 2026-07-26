// Admin promotion tool.
// By phone:       tcb fn invoke makeAdmin --params '{"phone":"1xxxxxxxxxx"}'
// By displayName: tcb fn invoke makeAdmin --params '{"displayName":"Wayne"}'
// Client calls require the caller to already be an admin; console/CLI
// invocations (no OPENID in context) are allowed for bootstrapping the first admin.
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    const callerSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
    const caller = callerSnap.data[0]
    if (!caller || caller.role !== 'admin') throw new Error('admins only')
  }

  const { phone, displayName } = event
  if (!phone && !displayName) throw new Error('provide phone or displayName')

  const query = phone
    ? db.collection('users').where({ phone }).limit(1).get()
    : db.collection('users').where({ displayName }).limit(1).get()

  const snap = await query
  if (!snap.data[0]) throw new Error('user not found')
  const uid = snap.data[0]._id
  await db.collection('users').doc(uid).update({ data: { role: 'admin' } })
  return { success: true, uid, displayName: snap.data[0].displayName }
}
