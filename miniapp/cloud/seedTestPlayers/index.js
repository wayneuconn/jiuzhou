const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// Admin-only test helper: seed N fake confirmed players into a match.
// Mark with _isTest:true so they can be wiped later.
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const { matchId, count = 10, action = 'seed' } = event

  if (action === 'wipe') {
    const testSnap = await db.collection('users').where({ _isTest: true }).get().catch(() => ({ data: [] }))
    let users = 0, regs = 0
    for (const u of testSnap.data) {
      // Delete all this user's registrations
      const userRegsSnap = await db.collection('registrations').where({ uid: u._id }).get().catch(() => ({ data: [] }))
      for (const r of userRegsSnap.data) {
        await db.collection('registrations').doc(r._id).remove().catch(() => {})
        regs++
      }
      await db.collection('users').doc(u._id).remove().catch(() => {})
      users++
    }
    return { wiped: { users, regs } }
  }

  // Seed
  if (!matchId) throw new Error('matchId required')

  const names = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十', '冯十一', '陈十二', '杨十三', '林十四']
  const positions = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']

  const created = []
  for (let i = 0; i < count; i++) {
    const name = names[i] || `测试${i + 1}`
    const fakeUid = `_test_${i}_${Math.random().toString(36).slice(2, 8)}`
    const pos = positions[i % positions.length]

    await db.collection('users').doc(fakeUid).set({
      data: {
        _id: fakeUid,
        openid: fakeUid,
        displayName: name,
        phone: '',
        preferredPositions: [pos],
        role: 'guest',
        membershipType: 'annual',
        attendanceCount: Math.floor(Math.random() * 20),
        lateCount: 0,
        dangerousCount: 0,
        createdAt: db.serverDate(),
        _isTest: true,
      },
    }).catch(() => {})

    const regId = matchId + '_' + fakeUid
    await db.collection('registrations').doc(regId).set({
      data: {
        matchId,
        uid: fakeUid,
        displayName: name,
        preferredPositions: [pos],
        registeredAt: db.serverDate(),
        status: 'confirmed',
        waitlistPosition: null,
        team: null,
        tags: [],
        autoAccept: true,
      },
    }).catch(() => {})

    created.push({ uid: fakeUid, name, position: pos })
  }

  return { created }
}
