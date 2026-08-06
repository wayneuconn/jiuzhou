const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const SCOPE_TYPES = { annual: ['annual'], member: ['annual', 'per_session'], all: null }

// Admin-only raw results feed for the live results page: full registrations
// (who answered what) plus the in-scope member list for non-response chasing.
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const { eventId } = event
  const evSnap = await db.collection('events').doc(eventId).get().catch(() => ({ data: null }))
  const ev = evSnap.data
  if (!ev) throw new Error('event not found')

  const types = SCOPE_TYPES[ev.scope] ?? ['annual']
  const userFilter = types ? { membershipType: _.in(types) } : {}

  const [regsSnap, scopeSnap] = await Promise.all([
    db.collection('eventRegistrations').where({ eventId }).limit(300).get().catch(() => ({ data: [] })),
    db.collection('users').where(userFilter)
      .field({ _id: true, displayName: true, membershipType: true })
      .limit(300).get().catch(() => ({ data: [] })),
  ])

  return {
    event: { ...ev, id: ev._id },
    regs: regsSnap.data,
    scopeUsers: scopeSnap.data,
  }
}
