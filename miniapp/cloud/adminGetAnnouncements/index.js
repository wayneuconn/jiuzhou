const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const res = await db.collection('announcements')
    .orderBy('pinned', 'desc')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
    .catch(() => ({ data: [] }))

  // Who has confirmed each 需确认 announcement
  const ackIds = res.data.filter(a => a.requireAck).map(a => a._id)
  const acks = ackIds.length
    ? await db.collection('announcementAcks').where({ annId: _.in(ackIds) })
        .orderBy('ackedAt', 'asc').limit(1000).get().catch(() => ({ data: [] }))
    : { data: [] }
  const byAnn = {}
  for (const r of acks.data) (byAnn[r.annId] = byAnn[r.annId] || []).push(r.displayName || '?')

  return {
    announcements: res.data.map(a => ({ ...a, id: a._id, ackNames: byAnn[a._id] || [] })),
  }
}
