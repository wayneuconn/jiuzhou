const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const [annRes, matchRes, configRes, eventRes] = await Promise.all([
    db.collection('announcements').orderBy('pinned', 'desc').orderBy('createdAt', 'desc').limit(5).get(),
    db.collection('matches')
      .where({ status: _.in(['registration_r1', 'registration_r2', 'drafting', 'ready']) })
      .orderBy('date', 'asc').limit(1).get(),
    db.collection('config').doc('app').get().catch(() => ({ data: null })),
    db.collection('events')
      .where({ status: _.in(['polling', 'registration']) })
      .orderBy('createdAt', 'desc').limit(1).get().catch(() => ({ data: [] })),
  ])
  const nextMatch = matchRes.data[0] ?? null
  const activeEvent = eventRes.data[0] ?? null
  return {
    announcements: annRes.data.map(a => ({ ...a, id: a._id })),
    nextMatch: nextMatch ? { ...nextMatch, id: nextMatch._id } : null,
    activeEvent: activeEvent ? { ...activeEvent, id: activeEvent._id } : null,
    season: configRes.data?.season ?? '',
  }
}
