const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

  return {
    match,
    registrations: registrations.map(r => ({ ...r, id: r._id })),
    agreementText: configSnap.data?.defaultAgreementText ?? '',
    formation,
    callerTeam,
    callerUid: callerUid ?? null,
    // Fresh identity for the action-state logic — globalData on the client is
    // a login-time snapshot and goes stale when an admin changes membership.
    callerInfo: caller ? {
      membershipType: caller.membershipType ?? 'none',
      role: caller.role ?? 'guest',
      banGamesLeft: caller.banGamesLeft ?? 0,
    } : null,
  }
}
