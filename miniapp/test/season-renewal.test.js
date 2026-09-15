// 赛季年卡登记: drive → player response → admin confirm → rollover.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, store, as, reset } = require('./harness')

const adminSeason = load('adminSeasonAction')
const respond = load('respondSeasonRenewal')

const NEXT = '2026-2027'

function seedClub() {
  reset()
  store.config = { app: { season: '2025-2026' } }
  store.users = {
    admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual', annualSeason: '2025-2026' },
    a1: { openid: 'a1@x', role: 'member', displayName: '张三', membershipType: 'annual', annualSeason: '2025-2026', attendanceCount: 20 },
    a2: { openid: 'a2@x', role: 'member', displayName: '李四', membershipType: 'annual', annualSeason: '2025-2026', attendanceCount: 15 },
    p1: { openid: 'p1@x', role: 'member', displayName: '王五', membershipType: 'per_session', attendanceCount: 8 },
  }
  as('admin@x')
}

const openDrive = (deadline = null) =>
  adminSeason({ action: 'openDrive', season: NEXT, deadline, note: '新赛季 9 月开踢' })

test('opening a drive notifies the current annual members', async () => {
  seedClub()
  const res = await openDrive()
  assert.equal(res.season, NEXT)
  assert.equal(store.seasonDrives[NEXT].status, 'open')
  assert.equal(res.notified, 3, 'the three annual holders, including the admin')
})

test('season name is validated', async () => {
  seedClub()
  await assert.rejects(() => adminSeason({ action: 'openDrive', season: '' }), /赛季名称/)
  await assert.rejects(() => adminSeason({ action: 'openDrive', season: 'x'.repeat(30) }), /赛季名称/)
})

test('a past deadline is rejected', async () => {
  seedClub()
  await assert.rejects(() => openDrive(Date.now() - 1000), /截止时间/)
})

test('player confirms, admin registers, card is stamped with the new season', async () => {
  seedClub()
  await openDrive()

  as('a1@x')
  const r = await respond({ response: 'continue', birthday: '3-7', note: '继续' })
  assert.equal(r.season, NEXT)
  const renewal = store.seasonRenewals[NEXT + '_a1']
  assert.equal(renewal.response, 'continue')
  assert.equal(renewal.status, 'pending', 'not granted yet — an admin confirms')
  assert.equal(renewal.birthday, '03-07', 'normalized to MM-DD')
  assert.equal(store.users.a1.annualSeason, '2025-2026', 'still last season until confirmed')

  as('admin@x')
  await adminSeason({ action: 'decideRenewal', renewalId: NEXT + '_a1', decision: 'confirmed' })
  assert.equal(store.users.a1.membershipType, 'annual')
  assert.equal(store.users.a1.annualSeason, NEXT, 'now stamped for the new season')
})

test('birthday is required to continue, and validated', async () => {
  seedClub()
  await openDrive()
  as('a1@x')

  await assert.rejects(() => respond({ response: 'continue' }), /生日/)
  await assert.rejects(() => respond({ response: 'continue', birthday: '13-01' }), /生日格式/)
  await assert.rejects(() => respond({ response: 'continue', birthday: '2-30' }), /生日格式/)
  // Leap day is a real birthday
  const ok = await respond({ response: 'continue', birthday: '2-29' })
  assert.equal(ok.success, true)
  assert.equal(store.users.a1.birthday, '02-29', 'mirrored onto the profile')
})

test('declining needs no birthday', async () => {
  seedClub()
  await openDrive()
  as('a2@x')
  await respond({ response: 'decline' })
  assert.equal(store.seasonRenewals[NEXT + '_a2'].response, 'decline')
  assert.equal(store.seasonRenewals[NEXT + '_a2'].birthday, null)
})

test('a declined response can be changed later', async () => {
  seedClub()
  await openDrive()
  as('a2@x')
  await respond({ response: 'decline' })
  await respond({ response: 'continue', birthday: '05-05' })
  assert.equal(store.seasonRenewals[NEXT + '_a2'].response, 'continue')
  assert.equal(store.seasonRenewals[NEXT + '_a2'].status, 'pending')
})

test('a confirmed registration cannot be quietly undone by the player', async () => {
  seedClub()
  await openDrive()
  as('a1@x')
  await respond({ response: 'continue', birthday: '01-01' })
  as('admin@x')
  await adminSeason({ action: 'decideRenewal', renewalId: NEXT + '_a1', decision: 'confirmed' })

  as('a1@x')
  await assert.rejects(() => respond({ response: 'decline' }), /联系管理员/)
})

test('responding needs an open, unexpired drive', async () => {
  seedClub()
  as('a1@x')
  await assert.rejects(() => respond({ response: 'continue', birthday: '01-01' }), /没有开放/)

  as('admin@x')
  await openDrive()
  store.seasonDrives[NEXT].deadline = Date.now() - 1000
  as('a1@x')
  await assert.rejects(() => respond({ response: 'continue', birthday: '01-01' }), /已截止/)
})

test('rollover downgrades only the unregistered, and to 次卡', async () => {
  seedClub()
  await openDrive()
  as('a1@x')
  await respond({ response: 'continue', birthday: '01-01' })
  as('admin@x')
  await adminSeason({ action: 'decideRenewal', renewalId: NEXT + '_a1', decision: 'confirmed' })

  const res = await adminSeason({ action: 'rollover', season: NEXT, confirm: true })

  assert.equal(store.users.a1.membershipType, 'annual', 'registered: keeps the card')
  assert.equal(store.users.a2.membershipType, 'per_session', 'did not register: 次卡, not 未激活')
  assert.equal(store.users.admin.membershipType, 'per_session', 'no exemption for admins')
  assert.equal(store.users.p1.membershipType, 'per_session', '次卡 players untouched')
  assert.equal(store.config.app.season, NEXT, 'current season switched')
  assert.equal(res.downgradedCount, 2)
})

test('rollover refuses without an explicit confirm', async () => {
  seedClub()
  await openDrive()
  await assert.rejects(() => adminSeason({ action: 'rollover', season: NEXT }), /confirm/)
  assert.equal(store.users.a2.membershipType, 'annual', 'nothing changed')
})

test('board shows who still owes a response and who rollover would hit', async () => {
  seedClub()
  await openDrive()
  as('a1@x')
  await respond({ response: 'continue', birthday: '01-01' })

  as('admin@x')
  const board = await adminSeason({ action: 'board' })
  assert.equal(board.currentSeason, '2025-2026')
  assert.equal(board.renewals.length, 1)
  assert.deepEqual(board.awaiting.map(u => u.displayName).sort(), ['李四', '管理员'])
  // a1 has responded but isn't confirmed yet, so still counts as stale
  assert.equal(board.wouldDowngrade.length, 3)
})

test('a drive cannot be reopened after its rollover', async () => {
  seedClub()
  await openDrive()
  await adminSeason({ action: 'rollover', season: NEXT, confirm: true })
  await assert.rejects(() => openDrive(), /已换季/)
})

test('non-admins cannot touch any of it', async () => {
  seedClub()
  as('a1@x')
  await assert.rejects(() => adminSeason({ action: 'openDrive', season: NEXT }), /admins only/)
  await assert.rejects(() => adminSeason({ action: 'rollover', season: NEXT, confirm: true }), /admins only/)
  await assert.rejects(() => adminSeason({ action: 'board' }), /admins only/)
})

test('confirming a decline is refused — nothing to grant', async () => {
  seedClub()
  await openDrive()
  as('a2@x')
  await respond({ response: 'decline' })
  as('admin@x')
  await assert.rejects(
    () => adminSeason({ action: 'decideRenewal', renewalId: NEXT + '_a2', decision: 'confirmed' }),
    /暂不继续/,
  )
})
