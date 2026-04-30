const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const [paymentsRes, eventsRes] = await Promise.all([
    db.collection('payments').orderBy('paidAt', 'desc').limit(200).get().catch(() => ({ data: [] })),
    db.collection('paymentEvents').orderBy('createdAt', 'desc').limit(20).get().catch(() => ({ data: [] })),
  ])
  return {
    payments: paymentsRes.data.map(p => ({ ...p, id: p._id })),
    events: eventsRes.data.map(e => ({ ...e, id: e._id })),
  }
}
