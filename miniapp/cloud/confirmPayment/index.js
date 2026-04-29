const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { paymentId } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user || user.role !== 'admin') throw new Error('admins only')

  await db.collection('payments').doc(paymentId).update({
    data: {
      status: 'confirmed',
      confirmedAt: db.serverDate(),
      confirmedBy: user._id,
    },
  })

  return { success: true }
}
