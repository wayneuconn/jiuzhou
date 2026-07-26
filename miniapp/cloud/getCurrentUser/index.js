const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const [userSnap, configSnap] = await Promise.all([
    db.collection('users').where({ openid: OPENID }).limit(1).get(),
    db.collection('config').doc('app').get().catch(() => ({ data: null })),
  ])
  const user = userSnap.data[0] ?? null

  // Caller's latest membership application (drives the 我的 page status card)
  let myApplication = null
  if (user) {
    const appSnap = await db.collection('membershipApplications')
      .where({ uid: user._id })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    const raw = appSnap.data[0] ?? null
    if (raw) {
      const toMs = (v) => {
        if (v && typeof v === 'object' && v._seconds) return v._seconds * 1000
        if (v instanceof Date) return v.getTime()
        return v ?? null
      }
      myApplication = { ...raw, id: raw._id, createdAt: toMs(raw.createdAt), decidedAt: toMs(raw.decidedAt) }
    }
  }

  // Pending-approval count for the admin red badge
  let pendingApplications = 0
  if (user?.role === 'admin') {
    const cnt = await db.collection('membershipApplications')
      .where({ status: 'pending' })
      .count()
      .catch(() => ({ total: 0 }))
    pendingApplications = cnt.total ?? 0
  }

  return {
    user,
    cardThresholds: configSnap.data?.cardThresholds ?? null,
    myApplication,
    pendingApplications,
  }
}
