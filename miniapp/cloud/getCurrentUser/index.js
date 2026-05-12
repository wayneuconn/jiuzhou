const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const [userSnap, configSnap] = await Promise.all([
    db.collection('users').where({ openid: OPENID }).limit(1).get(),
    db.collection('config').doc('app').get().catch(() => ({ data: null })),
  ])
  return {
    user: userSnap.data[0] ?? null,
    cardThresholds: configSnap.data?.cardThresholds ?? null,
  }
}
