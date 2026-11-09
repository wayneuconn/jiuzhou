// 12:00 之后报名只会进候补，不会自动递补，所以要提醒管理员和本场队长去安排
const { test } = require('node:test')
const assert = require('node:assert/strict')

const RealDate = Date
let fakeNow = 0
global.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [fakeNow])) }
  static now() { return fakeNow }
}

const { load, calls, as, seed } = require('./harness')
const register = load('registerForMatch')

const KICKOFF = RealDate.parse('2026-11-09T01:00:00Z')   // 2026-11-08 20:00 EST
const BEFORE = RealDate.parse('2026-11-08T16:30:00Z')    // 11:30 EST
const AFTER = RealDate.parse('2026-11-08T17:30:00Z')     // 12:30 EST

function seedMatch(at, { maxPlayers = 22, captains = {} } = {}) {
  fakeNow = at
  seed({
    users: {
      admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual' },
      capA: { openid: 'capA@x', role: 'member', displayName: '队长A', membershipType: 'annual' },
      capB: { openid: 'capB@x', role: 'member', displayName: '队长B', membershipType: 'annual' },
      s1: { openid: 's1@x', role: 'member', displayName: '次卡A', membershipType: 'per_session' },
    },
    matches: { open: { status: 'registration_r2', date: KICKOFF, maxPlayers, location: '球场', ...captains } },
  })
  calls.length = 0
}

const alerts = () => calls
  .filter(c => c.name === 'sendSubscribeMsg' && c.data.data.templateData.thing4.value === '12点后有人候补')
  .map(c => ({ to: c.data.toOpenid, text: c.data.data.templateData.thing2.value }))

test('after 12:00 a waitlisted signup alerts admins and both captains', async () => {
  seedMatch(AFTER, { captains: { captainA: 'capA', captainB: 'capB' } })
  as('s1@x')
  const res = await register({ matchId: 'open' })
  assert.equal(res.status, 'waitlist')
  const got = alerts()
  assert.deepEqual(got.map(a => a.to).sort(), ['admin@x', 'capA@x', 'capB@x'])
  assert.ok(got[0].text.startsWith('次卡A'))
  assert.equal(/\d+\/\d+/.test(got[0].text), false)
})

test('no captains yet: only admins hear about it', async () => {
  seedMatch(AFTER)
  as('s1@x')
  await register({ matchId: 'open' })
  assert.deepEqual(alerts().map(a => a.to), ['admin@x'])
})

test('a captain signing up late is not told about themselves', async () => {
  seedMatch(AFTER, { captains: { captainA: 'capA', captainB: 'capB' } })
  as('capA@x')
  await register({ matchId: 'open' })
  assert.deepEqual(alerts().map(a => a.to).sort(), ['admin@x', 'capB@x'])
})

test('before 12:00 nobody is alerted, even when the signup lands on the waitlist', async () => {
  seedMatch(BEFORE, { maxPlayers: 0 })
  as('s1@x')
  const res = await register({ matchId: 'open' })
  assert.equal(res.status, 'waitlist')
  assert.deepEqual(alerts(), [])
})

test('a friend brought after 12:00 is announced with who brought them', async () => {
  seedMatch(BEFORE)
  as('capA@x')
  await register({ matchId: 'open' })
  fakeNow = AFTER
  calls.length = 0
  await register({ matchId: 'open', friendName: '小王', friendPositions: ['FW'] })
  const got = alerts()
  assert.deepEqual(got.map(a => a.to), ['admin@x'])
  assert.ok(got[0].text.includes('小王'))
})
