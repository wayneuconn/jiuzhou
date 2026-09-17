const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()


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
  const { matchId } = event

  const [matchSnap, regsSnap, configSnap, userSnap] = await Promise.all([
    db.collection('matches').doc(matchId).get(),
    db.collection('registrations').where({ matchId }).orderBy('registeredAt', 'asc').get().catch(() => ({ data: [] })),
    db.collection('config').doc('app').get().catch(() => ({ data: null })),
    OPENID ? db.collection('users').where({ openid: OPENID }).limit(1).get().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
  ])

  const registrations = (regsSnap.data || []).map(r => ({
    ...r,
    registeredAt:    r.registeredAt?._seconds    ? r.registeredAt._seconds * 1000    : (r.registeredAt ?? null),
    promotedAt:      r.promotedAt?._seconds       ? r.promotedAt._seconds * 1000       : (r.promotedAt ?? null),
    confirmDeadline: r.confirmDeadline?._seconds  ? r.confirmDeadline._seconds * 1000  : (r.confirmDeadline ?? null),
  }))

  const match = matchSnap.data ? { ...matchSnap.data, id: matchSnap.data._id } : null

  // Determine caller's team for formation visibility
  const caller = userSnap.data[0]
  const callerUid = caller?._id
  const isAdmin = caller?.role === 'admin'
  const isCaptainA = match && callerUid && match.captainA === callerUid
  const isCaptainB = match && callerUid && match.captainB === callerUid
  const callerReg = callerUid ? registrations.find(r => r.uid === callerUid) : null
  const callerTeam = isCaptainA ? 'A' : isCaptainB ? 'B' : (callerReg?.team || null)

  // Load formation for caller's team only. Both boards go ONLY to admins
  // flagged with tacticsAll (owner) who aren't on either team — regular
  // admins see their own team like everyone else.
  let formation = null
  if (match && callerTeam) {
    const docId = matchId + '_' + callerTeam
    const fSnap = await db.collection('formations').doc(docId).get().catch(() => ({ data: null }))
    formation = fSnap.data ? { team: callerTeam, positions: fSnap.data.positions || {} } : { team: callerTeam, positions: {} }
  } else if (match && isAdmin && caller?.tacticsAll === true) {
    const [fa, fb] = await Promise.all([
      db.collection('formations').doc(matchId + '_A').get().catch(() => ({ data: null })),
      db.collection('formations').doc(matchId + '_B').get().catch(() => ({ data: null })),
    ])
    formation = {
      team: null,
      positions: { A: fa.data?.positions || {}, B: fb.data?.positions || {} },
    }
  }

  const waiverTitleForCaller = await db.collection('waivers')
    .doc(configSnap.data?.season ?? '_none').get()
    .then(r => r.data?.title ?? '').catch(() => '')

  // Active popup announcement (newest one still within its window)
  let popupAnn = null
  try {
    const now = Date.now()
    const annSnap = await db.collection('announcements')
      .where({ popup: true })
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get()
      .catch(() => ({ data: [] }))
    const live = annSnap.data.find(a => !a.popupUntil || a.popupUntil > now)
    if (live) popupAnn = { id: live._id, title: live.title, content: live.content }
  } catch (_) {}

  return {
    popupAnn,
    match,
    registrations: registrations.map(r => ({ ...r, id: r._id })),
    agreementText: configSnap.data?.defaultAgreementText ?? '',
    formation,
    callerTeam,
    callerUid: callerUid ?? null,
    // Fresh identity for the action-state logic — globalData on the client is
    // a login-time snapshot and goes stale when an admin changes membership.
    lateThreshold: configSnap.data?.lateThreshold ?? 0,
    // Penalty-GK halves already committed here, so the signup sheet only
    // offers a 全场 slot when the match can still absorb one.
    gkHalvesTaken: registrations
      .filter(r => r.gkPenalty && ['confirmed', 'promoted', 'waitlist'].includes(r.status))
      .reduce((n, r) => n + (r.gkHalves ?? 1), 0),
    callerInfo: caller ? {
      membershipType: caller.membershipType ?? 'none',
      role: caller.role ?? 'guest',
      banGamesLeft: caller.banGamesLeft ?? 0,
      lateCount: caller.lateCount ?? 0,
      gkHalvesOwed: caller.gkHalvesOwed ?? 0,
      absentCount: caller.absentCount ?? 0,
      // Lets the signup button stop someone before the server has to
      waiverPending: await waiverPendingFor(db, configSnap.data?.season ?? '', caller),
      waiverTitle: waiverTitleForCaller,
    } : null,
  }
}
