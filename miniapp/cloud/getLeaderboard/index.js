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

  // ── Captain leaderboard: derived from recorded scores, no extra bookkeeping.
  // Ranking (per team decision): average points (win 3 / draw 1 / loss 0),
  // tiebreak by average clamped goal difference (losses/draws count as 0).
  const matches = []
  for (let skip = 0; ; skip += PAGE) {
    const snap = await db.collection('matches')
      .where({ status: 'completed' })
      .field({ captainA: true, captainB: true, scoreA: true, scoreB: true })
      .skip(skip)
      .limit(PAGE)
      .get()
      .catch(() => ({ data: [] }))
    matches.push(...snap.data)
    if (snap.data.length < PAGE) break
  }

  const capMap = {}
  const record = (uid, diff) => {
    if (!uid) return
    const c = capMap[uid] ?? { uid, games: 0, wins: 0, draws: 0, losses: 0, clampedNet: 0 }
    c.games++
    if (diff > 0) { c.wins++; c.clampedNet += diff }
    else if (diff === 0) c.draws++
    else c.losses++
    capMap[uid] = c
  }
  for (const m of matches) {
    if (typeof m.scoreA !== 'number' || typeof m.scoreB !== 'number') continue
    record(m.captainA, m.scoreA - m.scoreB)
    record(m.captainB, m.scoreB - m.scoreA)
  }

  const capUids = Object.keys(capMap)
  const nameMap = {}
  for (let i = 0; i < capUids.length; i += 100) {
    const snap = await db.collection('users')
      .where({ _id: _.in(capUids.slice(i, i + 100)) })
      .field({ _id: true, displayName: true })
      .limit(100)
      .get()
      .catch(() => ({ data: [] }))
    for (const u of snap.data) nameMap[u._id] = u.displayName
  }

  const captains = Object.values(capMap)
    .map(c => {
      const points = c.wins * 3 + c.draws
      return {
        ...c,
        displayName: nameMap[c.uid] ?? '未知',
        points,
        avgPoints: Math.round((points / c.games) * 100) / 100,
        avgNet: Math.round((c.clampedNet / c.games) * 100) / 100,
        winRate: Math.round((c.wins / c.games) * 100),
      }
    })
    .sort((a, b) => b.avgPoints - a.avgPoints || b.avgNet - a.avgNet || b.games - a.games)
    .slice(0, 50)

  return { scorers, assisters, captains }
}
