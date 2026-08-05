const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = OPENID
    ? await db.collection('users').where({ openid: OPENID }).limit(1).get().catch(() => ({ data: [] }))
    : { data: [] }
  const isAdmin = userSnap.data[0]?.role === 'admin'

  const filter = isAdmin ? {} : { status: _.in(['polling', 'registration', 'closed']) }
  const snap = await db.collection('events')
    .where(filter)
    .orderBy('createdAt', 'desc')
    .limit(30)
    .get()
    .catch(() => ({ data: [] }))

  return {
    events: snap.data.map(e => ({ ...e, id: e._id })),
    isAdmin,
  }
}
