const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// Run once to create all collections and seed initial config.
exports.main = async (event, context) => {
  const results = {}

  // Create collections by inserting a placeholder then deleting it,
  // since WeChat cloud DB creates a collection on first insert.
  const collections = ['users', 'matches', 'announcements', 'payments', 'paymentEvents', 'inviteTokens', 'config']
  for (const name of collections) {
    try {
      await db.createCollection(name)
      results[name] = 'created'
    } catch (e) {
      // -502001 means collection already exists — that's fine
      results[name] = e.message.includes('-502001') ? 'already exists' : 'error: ' + e.message
    }
  }

  // Seed config/app document
  try {
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
  } catch (e) {
    results['config/app'] = 'error: ' + e.message
  }

  // Seed a pinned welcome announcement
  try {
    await db.collection('announcements').add({
      data: {
        title: '欢迎来到九州',
        content: '这里是九州球队管理平台，比赛报名、阵型安排、成员管理都在这里。',
        pinned: true,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    })
    results['announcement'] = 'seeded'
  } catch (e) {
    results['announcement'] = 'error: ' + e.message
  }

  return results
}
