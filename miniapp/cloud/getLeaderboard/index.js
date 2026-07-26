const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Aggregate goals/assists across all registrations (stats are only entered by
// admins on ready/completed matches, so no match-status join is needed).
exports.main = async (event, context) => {
  const PAGE = 1000
  const rows = []
  for (let skip = 0; ; skip += PAGE) {
    const snap = await db.collection('registrations')
      .where(_.or([{ goals: _.gt(0) }, { assists: _.gt(0) }]))
      .field({ uid: true, displayName: true, goals: true, assists: true })
      .skip(skip)
      .limit(PAGE)
      .get()
      .catch(() => ({ data: [] }))
    rows.push(...snap.data)
    if (snap.data.length < PAGE) break
  }

  const byUid = {}
  for (const r of rows) {
    const cur = byUid[r.uid] ?? { uid: r.uid, displayName: r.displayName, goals: 0, assists: 0 }
    cur.goals += r.goals ?? 0
    cur.assists += r.assists ?? 0
    cur.displayName = r.displayName || cur.displayName
    byUid[r.uid] = cur
  }

  const players = Object.values(byUid)
  const scorers = players
    .filter(p => p.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists)
    .slice(0, 50)
  const assisters = players
    .filter(p => p.assists > 0)
    .sort((a, b) => b.assists - a.assists || b.goals - a.goals)
    .slice(0, 50)

  return { scorers, assisters }
}
