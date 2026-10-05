const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 需确认 popup: record that the caller has read and confirmed it. Doc id is
// annId_uid, so confirming twice is a no-op.
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller) throw new Error('not logged in')

  const { id } = event
  if (!id) throw new Error('id required')
  const annSnap = await db.collection('announcements').doc(id).get().catch(() => ({ data: null }))
  if (!annSnap.data) throw new Error('announcement not found')

  await db.collection('announcementAcks').doc(id + '_' + caller._id).set({
    data: {
      annId: id,
      uid: caller._id,
      displayName: caller.displayName || '',
      ackedAt: Date.now(),
    },
  })
  return { success: true }
}
