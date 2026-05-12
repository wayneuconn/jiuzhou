const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const { config } = event
  if (!config) throw new Error('config required')

  const { _id, _openid, ...clean } = config
  await db.collection('config').doc('app').set({ data: clean })
  return { success: true }
}
