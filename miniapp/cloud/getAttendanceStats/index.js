const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { fromDate, toDate } = event // ms timestamps

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  // Server-side reads return at most one page per get(); paginate so the
  // ranking doesn't silently truncate once the range holds >100 registrations.
  async function getAll(query) {
    const PAGE = 1000
    const out = []
    for (let skip = 0; ; skip += PAGE) {
      const snap = await query.skip(skip).limit(PAGE).get().catch(() => ({ data: [] }))
      out.push(...snap.data)
      if (snap.data.length < PAGE) break
    }
    return out
  }

  // Find completed matches in the date range
  const matches = await getAll(
    db.collection('matches').where({ status: 'completed', date: _.gte(fromDate).and(_.lte(toDate)) })
  )
  if (matches.length === 0) return { stats: [], matchCount: 0 }

  const matchIds = matches.map(m => m._id)

  // Get all confirmed/promoted registrations for those matches (batch the
  // _.in list — it has a ~100-element limit)
  const regs = []
  for (let i = 0; i < matchIds.length; i += 100) {
    const batch = matchIds.slice(i, i + 100)
    regs.push(...await getAll(
      db.collection('registrations').where({ matchId: _.in(batch), status: _.in(['confirmed', 'promoted']) })
    ))
  }

  // Group by uid → count
  const countMap = {}
  const lateMap = {}
  const dangerMap = {}
  for (const reg of regs) {
    countMap[reg.uid] = (countMap[reg.uid] ?? 0) + 1
    if ((reg.tags ?? []).includes('late')) lateMap[reg.uid] = (lateMap[reg.uid] ?? 0) + 1
    if ((reg.tags ?? []).includes('dangerous')) dangerMap[reg.uid] = (dangerMap[reg.uid] ?? 0) + 1
  }

  const uids = Object.keys(countMap)
  if (uids.length === 0) return { stats: [], matchCount: matches.length }

  // Fetch user display names in batches (CloudBase _.in limit ~100)
  const userMap = {}
  for (let i = 0; i < uids.length; i += 100) {
    const batch = uids.slice(i, i + 100)
    const userSnaps = await db.collection('users')
      .where({ _id: _.in(batch) })
      .field({ _id: true, displayName: true, membershipType: true, preferredPositions: true })
      .limit(100)
      .get()
      .catch(() => ({ data: [] }))
    for (const u of userSnaps.data) userMap[u._id] = u
  }

  const stats = uids.map(uid => ({
    uid,
    displayName: userMap[uid]?.displayName ?? uid,
    membershipType: userMap[uid]?.membershipType ?? 'none',
    preferredPositions: userMap[uid]?.preferredPositions ?? [],
    count: countMap[uid],
    lateCount: lateMap[uid] ?? 0,
    dangerousCount: dangerMap[uid] ?? 0,
  })).sort((a, b) => b.count - a.count)

  return { stats, matchCount: matches.length }
}
