const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const [matchRes, userRes] = await Promise.all([
    db.collection('matches').orderBy('date', 'desc').limit(50).get(),
    OPENID
      ? db.collection('users').where({ openid: OPENID }).limit(1).get().catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
  ])
  const isAdmin = userRes.data[0]?.role === 'admin'
  return {
    matches: matchRes.data.map(m => ({ ...m, id: m._id })),
    isAdmin,
  }
}
