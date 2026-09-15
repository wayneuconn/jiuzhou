const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const [res, cfgSnap] = await Promise.all([
    db.collection('users').orderBy('displayName', 'asc').limit(200).get(),
    db.collection('config').doc('app').get().catch(() => ({ data: null })),
  ])
  return {
    members: res.data.map(u => ({ ...u, id: u._id })),
    // Lets the page grey out an 年卡 granted for an earlier season
    season: cfgSnap.data?.season ?? '',
  }
}
