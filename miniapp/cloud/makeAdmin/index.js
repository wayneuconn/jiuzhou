// One-time admin promotion tool.
// By phone:       tcb fn invoke makeAdmin --params '{"phone":"1xxxxxxxxxx"}'
// By displayName: tcb fn invoke makeAdmin --params '{"displayName":"Wayne"}'
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
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
