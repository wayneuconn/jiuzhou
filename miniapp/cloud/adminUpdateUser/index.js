const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const VALID_ROLES = ['admin', 'member', 'guest']
const VALID_MEMBERSHIPS = ['annual', 'per_session', 'none']

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { uid, role, membershipType, banGamesLeft } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')
  if (!uid) throw new Error('uid required')

  const update = {}
  if (role !== undefined) {
    if (!VALID_ROLES.includes(role)) throw new Error('invalid role')
    update.role = role
  }
  if (membershipType !== undefined) {
    if (!VALID_MEMBERSHIPS.includes(membershipType)) throw new Error('invalid membershipType')
    update.membershipType = membershipType
  }
  if (banGamesLeft !== undefined) {
    const n = parseInt(banGamesLeft, 10)
    if (isNaN(n) || n < 0) throw new Error('invalid banGamesLeft')
    update.banGamesLeft = n
  }
  if (Object.keys(update).length === 0) throw new Error('nothing to update')

  await db.collection('users').doc(uid).update({ data: update })
  return { success: true }
}
