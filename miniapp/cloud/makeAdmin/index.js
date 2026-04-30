// One-time admin promotion tool. Invoke via: tcb fn invoke makeAdmin --params '{"phone":"your-phone"}'
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { phone } = event
  if (!phone) throw new Error('phone required')
  const snap = await db.collection('users').where({ phone }).limit(1).get()
  if (!snap.data[0]) throw new Error('user not found for phone: ' + phone)
  const uid = snap.data[0]._id
  await db.collection('users').doc(uid).update({ data: { role: 'admin' } })
  return { success: true, uid, displayName: snap.data[0].displayName }
}
