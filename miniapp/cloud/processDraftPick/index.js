const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// "Your turn" nudge between the two captains (admins excluded by design).
// Uses the 活动开始通知 template captains bank when registering.
async function nudgeOtherCaptain(match, matchId, fromTeam) {
  const otherUid = fromTeam === 'A' ? match.captainB : match.captainA
  if (!otherUid) return
  try {
    const uSnap = await db.collection('users').doc(otherUid).get().catch(() => ({ data: null }))
    if (!uSnap.data?.openid) return
    const d = new Date(match.date)
    const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
    await cloud.callFunction({
      name: 'sendSubscribeMsg',
      data: {
        type: 'matchOpen',
        toOpenid: uSnap.data.openid,
        data: {
          page: `/pages/match-detail/index?id=${matchId}`,
          templateData: {
            thing4: { value: '该你选人了' },
            thing2: { value: `队长${fromTeam}已选完本轮`.slice(0, 20) },
            date5: { value: timeStr },
          },
        },
      },
    })
  } catch (_) {}
}

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
  // 'ready' included: after the draft ends a late replacement can still be
  // slotted onto a team by a captain/admin.
  if (!['drafting', 'ready'].includes(match.status)) throw new Error('draft not active')

  const team = callerUid === match.captainA ? 'A' : callerUid === match.captainB ? 'B' : null

  // ── nudge: "I'm done this round, your turn" — captain to captain only ─────
  if (event.nudge) {
    if (!team) throw new Error('仅队长可提醒对方')
    const lastAt = match.draftNudge?.at ?? 0
    if (Date.now() - lastAt < 60 * 1000) throw new Error('刚提醒过了，稍等一下再发')
    const to = team === 'A' ? 'B' : 'A'
    await db.collection('matches').doc(matchId).update({
      data: { draftNudge: { to, from: team, at: Date.now() } },
    }).catch(() => {})
    await nudgeOtherCaptain(match, matchId, team)
    return { success: true }
  }

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

  // No auto-completion: a captain (or admin) explicitly ends the draft with
  // 「选人结束」(setStatus ready) once both sides are happy.
  const unassignedSnap = await db.collection('registrations')
    .where({ matchId, status: _.in(['confirmed', 'promoted']), team: null })
    .count().catch(() => ({ total: 0 }))
  const remaining = unassignedSnap.total ?? 0

  return { success: true, team, remaining }
}
