const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const [annRes, matchRes, configRes, eventRes, userRes] = await Promise.all([
    db.collection('announcements').orderBy('pinned', 'desc').orderBy('createdAt', 'desc').limit(5).get(),
    db.collection('matches')
      .where({ status: _.in(['registration_r1', 'registration_r2', 'drafting', 'ready']) })
      .orderBy('date', 'asc').limit(1).get(),
    db.collection('config').doc('app').get().catch(() => ({ data: null })),
    db.collection('events')
      .where({ status: _.in(['polling', 'registration']) })
      .orderBy('createdAt', 'desc').limit(5).get().catch(() => ({ data: [] })),
    OPENID
      ? db.collection('users').where({ openid: OPENID }).limit(1).get().catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
  ])
  const nextMatch = matchRes.data[0] ?? null
  // Visibility = scope: the home card only shows events the caller can join
  const caller = userRes.data[0]
  const activeEvent = eventRes.data.find(e => {
    if (caller?.role === 'admin') return true
    const types = { annual: ['annual'], member: ['annual', 'per_session'], all: null }[e.scope] ?? ['annual']
    return types === null || (caller && types.includes(caller.membershipType))
  }) ?? null
  return {
    announcements: annRes.data.map(a => ({ ...a, id: a._id })),
    nextMatch: nextMatch ? { ...nextMatch, id: nextMatch._id } : null,
    activeEvent: activeEvent ? { ...activeEvent, id: activeEvent._id } : null,
    season: configRes.data?.season ?? '',
  }
}
