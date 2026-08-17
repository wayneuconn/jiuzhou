const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Minutes ET is behind UTC (300 for EST, 240 for EDT — handles DST)
function etOffsetMinutes(date) {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const etStr = date.toLocaleString('en-US', { timeZone: 'America/New_York' })
  return Math.round((new Date(utcStr) - new Date(etStr)) / 60000)
}

// Start of the current ET calendar month/year → epoch ms; null = all time
function periodStartTs(period) {
  if (period !== 'month' && period !== 'year') return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date())
  const y = Number(parts.find(p => p.type === 'year').value)
  const mo = Number(parts.find(p => p.type === 'month').value)
  const utcBase = period === 'month' ? new Date(Date.UTC(y, mo - 1, 1)) : new Date(Date.UTC(y, 0, 1))
  return utcBase.getTime() + etOffsetMinutes(utcBase) * 60000
}

async function getAll(makeQuery) {
  const PAGE = 1000
  const out = []
  for (let skip = 0; ; skip += PAGE) {
    const snap = await makeQuery().skip(skip).limit(PAGE).get().catch(() => ({ data: [] }))
    out.push(...snap.data)
    if (snap.data.length < PAGE) break
  }
  return out
}

// Leaderboards, optionally windowed to the current ET month/year.
// event.period: 'month' | 'year' | 'all' (default 'month')
exports.main = async (event, context) => {
  const period = ['month', 'year', 'all'].includes(event.period) ? event.period : 'month'
  const startTs = periodStartTs(period)

  // Completed matches drive both the captain board and the period filter for
  // goals/assists (registrations carry no date of their own).
  const matchFilter = startTs === null
    ? { status: 'completed' }
    : { status: 'completed', date: _.gte(startTs) }
  const matches = await getAll(() => db.collection('matches')
    .where(matchFilter)
    .field({ captainA: true, captainB: true, scoreA: true, scoreB: true, date: true, casual: true }))
  const matchIdSet = new Set(matches.map(m => m._id))

  // ── goals / assists ────────────────────────────────────────────────────────
  const rows = (await getAll(() => db.collection('registrations')
    .where(_.or([{ goals: _.gt(0) }, { assists: _.gt(0) }]))
    .field({ uid: true, displayName: true, goals: true, assists: true, matchId: true })))
    .filter(r => startTs === null || matchIdSet.has(r.matchId))

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

  // ── captains: average points (win 3 / draw 1 / loss 0), tiebreak avg
  // clamped net goals (losses/draws count 0) ────────────────────────────────
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
    // 娱乐局 doesn't count toward captain standings
    if (m.casual === true) continue
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

  return { scorers, assisters, captains, period }
}
