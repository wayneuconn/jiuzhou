const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = OPENID
    ? await db.collection('users').where({ openid: OPENID }).limit(1).get().catch(() => ({ data: [] }))
    : { data: [] }
  const caller = userSnap.data[0]
  const isAdmin = caller?.role === 'admin'

  const filter = isAdmin ? {} : { status: _.in(['polling', 'registration', 'closed']) }
  const snap = await db.collection('events')
    .where(filter)
    .orderBy('createdAt', 'desc')
    .limit(30)
    .get()
    .catch(() => ({ data: [] }))

  // Visibility = scope: non-admins only see events they can participate in
  const events = snap.data.filter(e => {
    if (isAdmin) return true
    const types = { annual: ['annual'], member: ['annual', 'per_session'], all: null }[e.scope] ?? ['annual']
    return types === null || (caller && types.includes(caller.membershipType))
  })

  return {
    events: events.map(e => ({ ...e, id: e._id })),
    isAdmin,
  }
}
