const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const [annRes, matchRes, configRes] = await Promise.all([
    db.collection('announcements').orderBy('pinned', 'desc').orderBy('createdAt', 'desc').limit(5).get(),
    db.collection('matches')
      .where({ status: _.in(['registration_r1', 'registration_r2', 'drafting', 'ready']) })
      .orderBy('date', 'asc').limit(1).get(),
    db.collection('config').doc('app').get().catch(() => ({ data: null })),
  ])
  const nextMatch = matchRes.data[0] ?? null
  return {
    announcements: annRes.data.map(a => ({ ...a, id: a._id })),
    nextMatch: nextMatch ? { ...nextMatch, id: nextMatch._id } : null,
    season: configRes.data?.season ?? '',
  }
}
