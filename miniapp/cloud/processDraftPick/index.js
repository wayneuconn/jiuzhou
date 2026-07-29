const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Free-for-all draft: either captain may pick any unassigned player at any
// time — no turn order. First tap wins on conflicts.
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId, pickedUid } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  const callerUid = caller?._id
  if (!callerUid) throw new Error('user not found')
  const isAdmin = caller.role === 'admin'

  const matchSnap = await db.collection('matches').doc(matchId).get()
  const match = matchSnap.data
  if (!match) throw new Error('match not found')
  if (match.status !== 'drafting') throw new Error('draft not active')

  const team = callerUid === match.captainA ? 'A' : callerUid === match.captainB ? 'B' : null

  // ── unpick: return a picked player to the unassigned pool ─────────────────
  if (event.unpickUid) {
    if (!team && !isAdmin) throw new Error('captains only')
    if (event.unpickUid === match.captainA || event.unpickUid === match.captainB) {
      throw new Error('队长不能退回池子')
    }
    const uRegId = matchId + '_' + event.unpickUid
    const uSnap = await db.collection('registrations').doc(uRegId).get().catch(() => ({ data: null }))
    if (!uSnap.data || !uSnap.data.team) throw new Error('该球员不在任何队伍中')
    if (!isAdmin && uSnap.data.team !== team) throw new Error('只能退回自己队的球员')
    await db.collection('registrations').doc(uRegId).update({ data: { team: null } })
    return { success: true, unpicked: event.unpickUid }
  }

  if (!team) throw new Error('captains only')

  // Conditional update doubles as the lock: only succeeds while the player
  // is still an unassigned member of the roster.
  const regId = matchId + '_' + pickedUid
  const res = await db.collection('registrations')
    .where({ _id: regId, matchId, status: _.in(['confirmed', 'promoted']), team: null })
    .update({ data: { team } })
  if (!res.stats || res.stats.updated === 0) {
    throw new Error('该球员已被选走或不在名单中，请刷新')
  }

  // Draft completes when nobody is left unassigned
  const unassignedSnap = await db.collection('registrations')
    .where({ matchId, status: _.in(['confirmed', 'promoted']), team: null })
    .count().catch(() => ({ total: 0 }))
  const remaining = unassignedSnap.total ?? 0
  if (remaining === 0) {
    await db.collection('matches').doc(matchId).update({ data: { status: 'ready', autoReady: true } }).catch(() => {})
  }

  return { success: true, team, remaining }
}
