const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { matchId } = event
  const [matchSnap, regsSnap] = await Promise.all([
    db.collection('matches').doc(matchId).get(),
    db.collection('matches').doc(matchId)
      .collection('registrations').orderBy('registeredAt', 'asc').get(),
  ])
  return { match: matchSnap.data, registrations: regsSnap.data }
}
