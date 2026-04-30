const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { matchId } = event
  const [matchSnap, regsSnap, configSnap] = await Promise.all([
    db.collection('matches').doc(matchId).get(),
    db.collection('matches').doc(matchId).collection('registrations').orderBy('registeredAt', 'asc').get(),
    db.collection('config').doc('app').get().catch(() => ({ data: null })),
  ])

  // Normalize any server timestamp fields in registrations to ms numbers
  const registrations = (regsSnap.data || []).map(r => ({
    ...r,
    registeredAt:    r.registeredAt?._seconds    ? r.registeredAt._seconds * 1000    : (r.registeredAt ?? null),
    promotedAt:      r.promotedAt?._seconds       ? r.promotedAt._seconds * 1000       : (r.promotedAt ?? null),
    confirmDeadline: r.confirmDeadline?._seconds  ? r.confirmDeadline._seconds * 1000  : (r.confirmDeadline ?? null),
  }))

  return {
    match: matchSnap.data,
    registrations,
    agreementText: configSnap.data?.defaultAgreementText ?? '',
  }
}
