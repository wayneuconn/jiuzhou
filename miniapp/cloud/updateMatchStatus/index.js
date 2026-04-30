const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const VALID_STATUSES = ['draft', 'registration_r1', 'registration_r2', 'drafting', 'ready', 'completed', 'cancelled']

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, matchId } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user || user.role !== 'admin') throw new Error('admins only')

  // ── status update ──────────────────────────────────────────────────────────
  if (!action || action === 'setStatus') {
    const { status } = event
    if (!VALID_STATUSES.includes(status)) throw new Error('invalid status')
    await db.collection('matches').doc(matchId).update({ data: { status } })
    return { success: true }
  }

  // ── assign player to team ──────────────────────────────────────────────────
  if (action === 'assignTeam') {
    const { uid, team } = event
    const regId = matchId + '_' + uid
    await db.collection('registrations').doc(regId).update({ data: { team: team ?? null } })
    return { success: true }
  }

  // ── toggle late/dangerous tag ──────────────────────────────────────────────
  if (action === 'toggleTag') {
    const { uid, tags } = event
    const regId = matchId + '_' + uid
    const regSnap = await db.collection('registrations').doc(regId).get()
    const oldTags = regSnap.data?.tags ?? []
    const newTags = tags ?? []

    const hadLate      = oldTags.includes('late')
    const hasLate      = newTags.includes('late')
    const hadDangerous = oldTags.includes('dangerous')
    const hasDangerous = newTags.includes('dangerous')

    await db.collection('registrations').doc(regId).update({ data: { tags: newTags } })

    if (hadLate !== hasLate) {
      await db.collection('users').doc(uid).update({ data: { lateCount: _.inc(hasLate ? 1 : -1) } })
    }
    if (hadDangerous !== hasDangerous) {
      await db.collection('users').doc(uid).update({ data: { dangerousCount: _.inc(hasDangerous ? 1 : -1) } })
    }
    return { success: true }
  }

  // ── set captain ────────────────────────────────────────────────────────────
  if (action === 'setCaptain') {
    const { slot, uid } = event

    // Clear old captain's team assignment
    const matchSnap = await db.collection('matches').doc(matchId).get()
    const prevUid = matchSnap.data?.[slot]
    if (prevUid && prevUid !== uid) {
      const prevRegId = matchId + '_' + prevUid
      await db.collection('registrations').doc(prevRegId).update({ data: { team: null } }).catch(() => {})
    }

    await db.collection('matches').doc(matchId).update({ data: { [slot]: uid ?? null } })

    if (uid) {
      const team = slot === 'captainA' ? 'A' : 'B'
      const regId = matchId + '_' + uid
      await db.collection('registrations').doc(regId).update({ data: { team } })
    }
    return { success: true }
  }

  throw new Error('unknown action: ' + action)
}
