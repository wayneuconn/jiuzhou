const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const res = await db.collection('announcements')
    .orderBy('pinned', 'desc')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
    .catch(() => ({ data: [] }))

  return { announcements: res.data.map(a => ({ ...a, id: a._id })) }
}
