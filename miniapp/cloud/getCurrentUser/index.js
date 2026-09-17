const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const [userSnap, configSnap] = await Promise.all([
    db.collection('users').where({ openid: OPENID }).limit(1).get(),
    db.collection('config').doc('app').get().catch(() => ({ data: null })),
  ])
  const user = userSnap.data[0] ?? null

  // 赛季确认书: the current season's document and whether this caller is clear
  let seasonWaiver = null
  try {
    const season = configSnap.data?.season ?? ''
    if (season) {
      const wSnap = await db.collection('waivers').doc(season).get().catch(() => ({ data: null }))
      if (wSnap.data) {
        let signed = false
        if (user) {
          const sig = await db.collection('waiverSignatures')
            .doc(season + '_' + user._id).get().catch(() => ({ data: null }))
          signed = !!sig.data && sig.data.version === wSnap.data.version
        }
        seasonWaiver = {
          season,
          title: wSnap.data.title,
          body: wSnap.data.body,
          version: wSnap.data.version,
          required: wSnap.data.required !== false,
          signed,
        }
      }
    }
  } catch (_) {}

  // 赛季年卡登记: the open drive and this caller's response to it
  let seasonDrive = null
  let myRenewal = null
  try {
    const driveSnap = await db.collection('seasonDrives')
      .where({ status: 'open' }).orderBy('openedAt', 'desc').limit(1).get().catch(() => ({ data: [] }))
    const drive = driveSnap.data[0]
    if (drive && (!drive.deadline || drive.deadline > Date.now())) {
      seasonDrive = {
        season: drive.season,
        deadline: drive.deadline ?? null,
        note: drive.note ?? '',
        questions: drive.questions ?? [],
      }
      if (user) {
        const rSnap = await db.collection('seasonRenewals')
          .doc(drive.season + '_' + user._id).get().catch(() => ({ data: null }))
        if (rSnap.data) {
          myRenewal = {
            season: rSnap.data.season,
            response: rSnap.data.response,
            status: rSnap.data.status,
            birthday: rSnap.data.birthday ?? null,
            answers: rSnap.data.answers ?? {},
          }
        }
      }
    }
  } catch (_) {}

  // Caller's latest membership application (drives the 我的 page status card)
  let myApplication = null
  if (user) {
    const appSnap = await db.collection('membershipApplications')
      .where({ uid: user._id })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    const raw = appSnap.data[0] ?? null
    if (raw) {
      const toMs = (v) => {
        if (v && typeof v === 'object' && v._seconds) return v._seconds * 1000
        if (v instanceof Date) return v.getTime()
        return v ?? null
      }
      myApplication = { ...raw, id: raw._id, createdAt: toMs(raw.createdAt), decidedAt: toMs(raw.decidedAt) }
    }
  }

  // Pending-approval count for the admin red badge
  let pendingApplications = 0
  if (user?.role === 'admin') {
    const cnt = await db.collection('membershipApplications')
      .where({ status: 'pending' })
      .count()
      .catch(() => ({ total: 0 }))
    pendingApplications = cnt.total ?? 0
  }

  return {
    user,
    cardThresholds: configSnap.data?.cardThresholds ?? null,
    myApplication,
    pendingApplications,
    season: configSnap.data?.season ?? '',
    seasonDrive,
    myRenewal,
    seasonWaiver,
  }
}
