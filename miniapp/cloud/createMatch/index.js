const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user || user.role !== 'admin') throw new Error('admins only')

  const configSnap = await db.collection('config').doc('app').get()
  const config = configSnap.data ?? {}

  const res = await db.collection('matches').add({
    data: {
      date: event.date ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      location: event.location ?? '待定',
      maxPlayers: event.maxPlayers ?? 22,
      status: 'draft',
      captainA: null,
      captainB: null,
      draftState: null,
      agreementText: config.defaultAgreementText ?? '',
      createdAt: db.serverDate(),
    },
  })

  return { matchId: res._id }
}
