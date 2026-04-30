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

  // Find completed matches in the date range
  const matchSnap = await db.collection('matches')
    .where({ status: 'completed', date: _.gte(fromDate).and(_.lte(toDate)) })
    .get()

  const matches = matchSnap.data
  if (matches.length === 0) return { stats: [], matchCount: 0 }

  const matchIds = matches.map(m => m._id)

  // Get all confirmed/promoted registrations for those matches
  const regsSnap = await db.collection('registrations')
    .where({ matchId: _.in(matchIds), status: _.in(['confirmed', 'promoted']) })
    .get()
    .catch(() => ({ data: [] }))

  // Group by uid → count
  const countMap = {}
  const lateMap = {}
  const dangerMap = {}
  for (const reg of regsSnap.data) {
    countMap[reg.uid] = (countMap[reg.uid] ?? 0) + 1
    if ((reg.tags ?? []).includes('late')) lateMap[reg.uid] = (lateMap[reg.uid] ?? 0) + 1
    if ((reg.tags ?? []).includes('dangerous')) dangerMap[reg.uid] = (dangerMap[reg.uid] ?? 0) + 1
  }

  const uids = Object.keys(countMap)
  if (uids.length === 0) return { stats: [], matchCount: matches.length }

  // Fetch user display names in batches (CloudBase _.in limit ~100)
  const userSnaps = await db.collection('users')
    .where({ _id: _.in(uids) })
    .field({ _id: true, displayName: true, membershipType: true, preferredPositions: true })
    .get()

  const userMap = {}
  for (const u of userSnaps.data) userMap[u._id] = u

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
