const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// Admin-only test helper: seed N fake confirmed players into a match.
// Mark with _isTest:true so they can be wiped later.
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  // CLI invocations have no OPENID; allow. WeChat client invocations must be admin.
  if (OPENID) {
    const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
    const caller = userSnap.data[0]
    if (!caller || caller.role !== 'admin') throw new Error('admins only')
  }

  const { matchId, count = 10, action = 'seed', setStatus } = event

  // List matches — useful for dev to find matchId
  if (action === 'list') {
    const matchesSnap = await db.collection('matches').orderBy('date', 'desc').limit(20).get().catch(() => ({ data: [] }))
    return {
      matches: matchesSnap.data.map(m => ({
        _id: m._id, date: m.date, location: m.location, status: m.status,
        captainA: m.captainA, captainB: m.captainB, maxPlayers: m.maxPlayers,
      })),
    }
  }

  if (action === 'wipe') {
    const testSnap = await db.collection('users').where({ _isTest: true }).get().catch(() => ({ data: [] }))
    let users = 0, regs = 0
    for (const u of testSnap.data) {
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

  // Optionally change the match status (e.g., rollback to registration_r2)
  if (setStatus) {
    const updateData = { status: setStatus, autoReady: false }
    if (event.clearCaptains) {
      updateData.captainA = null
      updateData.captainB = null
      updateData.draftState = null
    }
    if (setStatus === 'drafting' && !event.clearCaptains) {
      // Init draftState properly
      const mSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
      const m = mSnap.data
      if (m && m.captainA && m.captainB) {
        const _ = db.command
        const capAReg = matchId + '_' + m.captainA
        const capBReg = matchId + '_' + m.captainB
        await db.collection('registrations').doc(capAReg).update({ data: { team: 'A' } }).catch(() => {})
        await db.collection('registrations').doc(capBReg).update({ data: { team: 'B' } }).catch(() => {})
        const remSnap = await db.collection('registrations')
          .where({ matchId, status: _.in(['confirmed', 'promoted']), uid: _.nin([m.captainA, m.captainB]) })
          .count().catch(() => ({ total: 0 }))
        const rem = remSnap.total ?? 0
        const pickOrder = []
        let team = 'A', n = 0
        for (let i = 0; i < rem; i++) { pickOrder.push(team); n++; if (n === 2) { team = team === 'A' ? 'B' : 'A'; n = 0 } }
        updateData.draftState = { pickOrder, pickIndex: 0, currentTurn: 'A' }
      }
    }
    try {
      const upRes = await db.collection('matches').doc(matchId).update({ data: updateData })
      console.log('update result', upRes)
    } catch (e) {
      return { error: 'update failed: ' + e.message, updateData }
    }
  }

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
