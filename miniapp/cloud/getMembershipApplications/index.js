const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// serverDate fields may serialize as {_seconds} — normalize to epoch ms
function toMs(v) {
  if (v && typeof v === 'object' && v._seconds) return v._seconds * 1000
  if (v instanceof Date) return v.getTime()
  return v ?? null
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const callerSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = callerSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const [pendingSnap, decidedSnap] = await Promise.all([
    db.collection('membershipApplications')
      .where({ status: 'pending' })
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get()
      .catch(() => ({ data: [] })),
    db.collection('membershipApplications')
      .where({ status: db.command.in(['approved', 'rejected']) })
      .orderBy('decidedAt', 'desc')
      .limit(20)
      .get()
      .catch(() => ({ data: [] })),
  ])

  // Live user snapshot for pending apps — the admin decides against current
  // membership/attendance, not the values at application time.
  const pending = []
  for (const app of pendingSnap.data) {
    const uSnap = await db.collection('users').doc(app.uid).get().catch(() => ({ data: null }))
    pending.push({
      ...app,
      id: app._id,
      createdAt: toMs(app.createdAt),
      decidedAt: toMs(app.decidedAt),
      currentType: uSnap.data?.membershipType ?? app.currentType,
      attendanceCount: uSnap.data?.attendanceCount ?? app.attendanceCount,
    })
  }

  return {
    pending,
    decided: decidedSnap.data.map(a => ({ ...a, id: a._id, createdAt: toMs(a.createdAt), decidedAt: toMs(a.decidedAt) })),
    pendingCount: pending.length,
  }
}
