const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// Minutes ET is behind UTC (300 for EST, 240 for EDT — handles DST)
function etOffsetMinutes(date) {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const etStr = date.toLocaleString('en-US', { timeZone: 'America/New_York' })
  return Math.round((new Date(utcStr) - new Date(etStr)) / 60000)
}

// 'YYYY-MM-DD' + 'HH:mm' interpreted in ET → epoch ms.
// Kickoff times are Eastern regardless of the admin device's timezone.
function etTimestamp(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = (timeStr || '20:00').split(':').map(Number)
  const utcBase = new Date(Date.UTC(y, m - 1, d))
  return utcBase.getTime() + etOffsetMinutes(utcBase) * 60000 + hh * 3600000 + (mm || 0) * 60000
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user || user.role !== 'admin') throw new Error('admins only')

  const configSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const config = configSnap.data ?? {}

  let date
  if (event.dateStr) date = etTimestamp(event.dateStr, event.timeStr)
  else if (typeof event.date === 'number') date = event.date
  else date = Date.now() + 7 * 24 * 60 * 60 * 1000

  const res = await db.collection('matches').add({
    data: {
      date,
      location: event.location ?? '待定',
      maxPlayers: 22,
      status: 'draft',
      autoReady: false,
      captainA: null,
      captainB: null,
      agreementText: config.defaultAgreementText ?? '',
      createdAt: db.serverDate(),
    },
  })

  return { matchId: res._id }
}
