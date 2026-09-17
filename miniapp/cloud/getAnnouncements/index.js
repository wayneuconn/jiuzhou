const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command


// True only when the waiver actually gates registration AND this caller is a
// member who hasn't confirmed. Visitors and 未激活 accounts are never nagged —
// which also keeps a review account clear of it.
async function waiverPendingFor(db, season, user) {
  if (!season || !user) return false
  if (!['annual', 'per_session'].includes(user.membershipType)) return false
  const wSnap = await db.collection('waivers').doc(season).get().catch(() => ({ data: null }))
  if (!wSnap.data || wSnap.data.required === false) return false
  const sig = await db.collection('waiverSignatures')
    .doc(season + '_' + user._id).get().catch(() => ({ data: null }))
  return !sig.data || sig.data.version !== wSnap.data.version
}

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
  const waiverTitle = await db.collection('waivers')
    .doc(configRes.data?.season ?? '_none').get()
    .then(r => r.data?.title ?? '').catch(() => '')

  // 赛季年卡登记 prompt: shown only to someone who has something to do about
  // it — an annual member who hasn't responded yet. No tallies anywhere.
  let seasonDrive = null
  try {
    const me = userRes.data[0]
    if (me && me.membershipType === 'annual') {
      const driveSnap = await db.collection('seasonDrives')
        .where({ status: 'open' }).orderBy('openedAt', 'desc').limit(1).get().catch(() => ({ data: [] }))
      const drive = driveSnap.data[0]
      if (drive && (!drive.deadline || drive.deadline > Date.now())) {
        const rSnap = await db.collection('seasonRenewals')
          .doc(drive.season + '_' + me._id).get().catch(() => ({ data: null }))
        if (!rSnap.data) {
          seasonDrive = { season: drive.season, deadline: drive.deadline ?? null }
        }
      }
    }
  } catch (_) {}
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
    seasonDrive,
    waiverPending: await waiverPendingFor(db, configRes.data?.season ?? '', caller),
    waiverTitle: waiverTitle,
  }
}
