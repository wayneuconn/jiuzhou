const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const res = await db.collection('announcements')
    .orderBy('pinned', 'desc')
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get()
  return { announcements: res.data }
}
