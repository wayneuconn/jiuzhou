// One-off migration for the 旷赛 rule change (禁赛 4 场 → 欠 2 个半场门将).
//
// Every ban still on the books that came from an absence becomes GK debt
// instead, pro-rated against what's left of the ban: a full 4-game ban buys
// back 2 halves, a half-served one buys back 1.
//
// There's no field recording *why* someone was banned, so the heuristic is
// "absentCount > 0 && banGamesLeft > 0" — which also catches a manual ban on
// someone who happens to have an old absence. Run it dry first and read the
// report before applying.
//
//   ./scripts/tcb.sh fn deploy migrateAbsentBan -e "$JIUZHOU_ENV" --force
//   ./scripts/tcb.sh fn invoke migrateAbsentBan -e "$JIUZHOU_ENV" \
//     --params '{"confirm":"MIGRATE_ABSENT_BAN"}'                      # dry run
//   ./scripts/tcb.sh fn invoke migrateAbsentBan -e "$JIUZHOU_ENV" \
//     --params '{"confirm":"MIGRATE_ABSENT_BAN","apply":true}'         # for real
//
// Safe to re-run: a converted user is stamped with absentBanMigratedAt and
// skipped from then on. Delete the function once it has run.
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const BAN_GAMES_PER_ABSENCE = 4

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  // From the mini program: admins only. From the CLI (no OPENID): the token.
  if (OPENID) {
    const callerSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
    const caller = callerSnap.data[0]
    if (!caller || caller.role !== 'admin') throw new Error('admins only')
  } else if (event.confirm !== 'MIGRATE_ABSENT_BAN') {
    throw new Error('confirm token required')
  }

  const apply = event.apply === true
  const cfgSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const penalty = Math.max(1, parseInt(cfgSnap.data?.absentGkHalves ?? 2, 10) || 2)

  const snap = await db.collection('users')
    .where({ absentCount: _.gt(0), banGamesLeft: _.gt(0) })
    .limit(500)
    .get()
    .catch(() => ({ data: [] }))

  const converted = []
  const skipped = []
  for (const u of snap.data) {
    if (u.absentBanMigratedAt) {
      skipped.push({ name: u.displayName || u._id, reason: 'already migrated' })
      continue
    }
    const banLeft = u.banGamesLeft ?? 0
    // Pro-rate the unserved part of the ban, but never forgive it entirely
    const halves = Math.max(1, Math.round((banLeft / BAN_GAMES_PER_ABSENCE) * penalty))
    const newOwed = (u.gkHalvesOwed ?? 0) + halves
    converted.push({
      name: u.displayName || u._id,
      absentCount: u.absentCount ?? 0,
      banGamesLeft: banLeft,
      gkHalvesOwedBefore: u.gkHalvesOwed ?? 0,
      gkHalvesOwedAfter: newOwed,
    })
    if (apply) {
      await db.collection('users').doc(u._id).update({
        data: { banGamesLeft: 0, gkHalvesOwed: newOwed, absentBanMigratedAt: db.serverDate() },
      }).catch(() => {})
    }
  }

  // Backfill the two new counters so the admin lists render them as 0, not blank
  let backfilled = 0
  if (apply) {
    for (const field of ['gkHalvesOwed', 'absentCount']) {
      const missing = await db.collection('users')
        .where({ [field]: _.exists(false) })
        .limit(500)
        .get()
        .catch(() => ({ data: [] }))
      for (const u of missing.data) {
        await db.collection('users').doc(u._id).update({ data: { [field]: 0 } }).catch(() => {})
        backfilled++
      }
    }
  }

  return {
    mode: apply ? 'applied' : 'dry-run (nothing written)',
    halvesPerAbsence: penalty,
    convertedCount: converted.length,
    converted,
    skipped,
    backfilled,
  }
}
