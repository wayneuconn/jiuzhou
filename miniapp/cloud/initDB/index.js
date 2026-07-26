const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// Run once to create all collections and seed initial config.
// Client calls require an admin caller; console/CLI invocations (no OPENID)
// are allowed for first-time setup.
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    const callerSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
    const caller = callerSnap.data[0]
    if (!caller || caller.role !== 'admin') throw new Error('admins only')
  }

  const results = {}

  const collections = ['users', 'matches', 'registrations', 'announcements', 'payments', 'paymentEvents', 'inviteTokens', 'config', 'formations', 'membershipApplications']
  for (const name of collections) {
    try {
      await db.createCollection(name)
      results[name] = 'created'
    } catch (e) {
      const msg = (e && e.message) || ''
      // -502001 means collection already exists — that's fine
      results[name] = (msg.includes('-502001') || msg.includes('ResourceExist')) ? 'already exists' : 'error: ' + msg
    }
  }

  // Seed config/app document only if it doesn't exist yet — never clobber live settings.
  try {
    const existing = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
    if (existing.data) {
      results['config/app'] = 'already exists, skipped'
    } else {
      await db.collection('config').doc('app').set({
        data: {
          season: '2025-2026',
          cardThresholds: { bronze: 5, silver: 10, gold: 20, blue: 30 },
          waitlistConfirmMinutes: 30,
          defaultAgreementText: '参与者需遵守比赛规则，尊重裁判和对手，安全第一。',
          defaultAnnouncement: '欢迎加入九州球队！',
          perSessionFee: 20,
        },
      })
      results['config/app'] = 'seeded'
    }
  } catch (e) {
    results['config/app'] = 'error: ' + ((e && e.message) || '')
  }

  return results
}
