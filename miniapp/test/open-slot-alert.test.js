// 12:00 之后有人退出，空位不会自动补，要提醒管理员和本场队长从候补拉人
const { test } = require('node:test')
const assert = require('node:assert/strict')

const RealDate = Date
let fakeNow = 0
global.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [fakeNow])) }
  static now() { return fakeNow }
}

const { load, store, calls, as, seed } = require('./harness')
const withdraw = load('withdrawFromMatch')
const timeout = load('confirmationTimeout')

const KICKOFF = RealDate.parse('2026-11-09T01:00:00Z')   // 2026-11-08 20:00 EST
const BEFORE = RealDate.parse('2026-11-08T16:30:00Z')    // 11:30 EST
const AFTER = RealDate.parse('2026-11-08T17:30:00Z')     // 12:30 EST

const reg = (uid, name, extra) => ({ matchId: 'open', uid, displayName: name, tags: [], ...extra })

function seedMatch(at, { waiters = true } = {}) {
  fakeNow = at
  seed({
    users: {
      admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual' },
      capA: { openid: 'capA@x', role: 'member', displayName: '队长A', membershipType: 'annual' },
      capB: { openid: 'capB@x', role: 'member', displayName: '队长B', membershipType: 'annual' },
      p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual' },
      w1: { openid: 'w1@x', role: 'member', displayName: '李四', membershipType: 'per_session' },
      w2: { openid: 'w2@x', role: 'member', displayName: '王五', membershipType: 'annual' },
    },
    matches: { open: { status: 'registration_r2', date: KICKOFF, maxPlayers: 3, location: '球场', captainA: 'capA', captainB: 'capB' } },
    registrations: {
      open_capA: reg('capA', '队长A', { status: 'confirmed' }),
      open_capB: reg('capB', '队长B', { status: 'confirmed' }),
      open_p1: reg('p1', '张三', { status: 'confirmed' }),
      ...(waiters ? {
        open_w1: reg('w1', '李四', { status: 'waitlist', waitlistPosition: 1, waitlistTier: 3, waitlistLate: false }),
        open_w2: reg('w2', '王五', { status: 'waitlist', waitlistPosition: 2, waitlistTier: 1, waitlistLate: true }),
      } : {}),
    },
  })
  calls.length = 0
}

const alerts = () => calls
  .filter(c => c.name === 'sendSubscribeMsg' && c.data.data.templateData.thing4.value.includes('请从候补拉人'))
  .map(c => ({ to: c.data.toOpenid, head: c.data.data.templateData.thing4.value, body: c.data.data.templateData.thing2.value }))

test('after 12:00 a withdrawal tells admins and both captains who is waiting, in queue order', async () => {
  seedMatch(AFTER)
  as('p1@x')
  await withdraw({ matchId: 'open' })
  const got = alerts()
  assert.deepEqual(got.map(a => a.to).sort(), ['admin@x', 'capA@x', 'capB@x'])
  assert.equal(got[0].head, '张三 退出了，请从候补拉人')
  assert.equal(got[0].body, '候补：李四、王五')
  assert.equal(store.registrations.open_w1.status, 'waitlist')
})

test('the old 退出了 admin alert is not sent on top of it', async () => {
  seedMatch(AFTER)
  as('p1@x')
  await withdraw({ matchId: 'open', mode: 'excuse' })
  const toAdmin = calls.filter(c => c.data?.toOpenid === 'admin@x')
  assert.equal(toAdmin.length, 1)
  assert.equal(toAdmin[0].data.data.templateData.thing4.value, '张三 请假了，请从候补拉人')
})

test('a captain leaving is not told about their own slot', async () => {
  seedMatch(AFTER)
  as('capA@x')
  await withdraw({ matchId: 'open' })
  assert.deepEqual(alerts().map(a => a.to).sort(), ['admin@x', 'capB@x'])
})

test('empty waitlist: nothing to pull, admins get the usual alert', async () => {
  seedMatch(AFTER, { waiters: false })
  as('p1@x')
  await withdraw({ matchId: 'open' })
  assert.deepEqual(alerts(), [])
  assert.equal(calls.filter(c => c.data?.toOpenid === 'admin@x').length, 1)
})

test('before 12:00 the waitlist fills itself, so no pull-in alert', async () => {
  seedMatch(BEFORE)
  as('p1@x')
  await withdraw({ matchId: 'open' })
  assert.deepEqual(alerts(), [])
})

test('a waiter dropping out frees no slot and alerts nobody', async () => {
  seedMatch(AFTER)
  as('w1@x')
  await withdraw({ matchId: 'open' })
  assert.deepEqual(alerts(), [])
})

test('after 12:00 an expired promotion also asks for someone to be pulled in', async () => {
  seedMatch(AFTER)
  store.registrations.open_p1.status = 'promoted'
  store.registrations.open_p1.confirmDeadline = AFTER - 1000
  await timeout({})
  const got = alerts()
  assert.deepEqual(got.map(a => a.to).sort(), ['admin@x', 'capA@x', 'capB@x'])
  assert.equal(got[0].head, '张三 超时未确认，请从候补拉人')
})
