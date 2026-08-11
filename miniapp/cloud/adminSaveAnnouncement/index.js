const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const { id, title, content, pinned, popup, popupUntil } = event
  if (!title || !content) throw new Error('title and content required')

  const data = {
    title,
    content,
    pinned: !!pinned,
    popup: !!popup,
    // null = show indefinitely
    popupUntil: typeof popupUntil === 'number' ? popupUntil : null,
    updatedAt: db.serverDate(),
  }

  if (id) {
    await db.collection('announcements').doc(id).update({ data })
    return { success: true, id }
  } else {
    const res = await db.collection('announcements').add({
      data: { ...data, createdAt: db.serverDate() },
    })
    return { success: true, id: res._id }
  }
}
