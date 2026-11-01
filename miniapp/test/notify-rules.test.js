// 通知规则：定时/广播通知由 notifyRules 集合驱动，runNotifyRules 执行。
const { test } = require('node:test')
const assert = require('node:assert/strict')

// Pin the clock: time rules fire off wall-clock ET time
const RealDate = Date
let fakeNow = 0
global.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [fakeNow])) }
  static now() { return fakeNow }
}

const { load, store, calls, as, seed } = require('./harness')
const run = load('runNotifyRules')
const admin = load('adminNotifyRules')
const cron = load('confirmationTimeout')
const updateMatchStatus = load('updateMatchStatus')

const KICKOFF = RealDate.parse('2026-10-10T23:00:00Z')    // 19:00 EDT
const MORNING = RealDate.parse('2026-10-10T15:55:00Z')    // 11:55 EDT
const NOON = RealDate.parse('2026-10-10T16:05:00Z')       // 12:05 EDT

const sends = () => calls.filter(c => c.name === 'sendSubscribeMsg')
const sentTo = () => sends().map(c => c.data.toOpenid).sort()
const rule = name => Object.entries(store.notifyRules).find(([, r]) => r.name === name)

function seedClub(status = 'registration_r2', { seeded = true } = {}) {
  fakeNow = MORNING
  seed({
    config: { notifyRulesSeeded: seeded },
    users: { p4: { openid: 'p4@x', role: 'member', displayName: '赵六', membershipType: 'per_session' } },
    matches: { open: { status, date: KICKOFF, maxPlayers: 22, location: '球场' } },
    registrations: {
      open_p1: { matchId: 'open', uid: 'p1', status: 'confirmed' },
      open_p2: { matchId: 'open', uid: 'p2', status: 'waitlist' },
      open_g1: { matchId: 'open', uid: 'p3', status: 'confirmed', isGuest: true, broughtBy: 'p3' },
    },
  })
  store.notifyRules = {}
  store.notifyLog = {}
}

const addRule = r => { store.notifyRules[r.id] = { enabled: true, ...r } }

test('first run installs the old hard-coded rules without re-sending them', async () => {
  seedClub('registration_r2', { seeded: false })
  await run({})
  const names = Object.values(store.notifyRules).map(r => r.name).sort()
  assert.deepEqual(names, ['R1 开放 → 年卡', 'R2 开放 → 次卡', '比赛当天中午提醒'].sort())
  assert.equal(store.config.app.notifyRulesSeeded, true)
  assert.equal(sends().length, 0, 'the match already in R2 does not get a second R2 blast')

  // …but the noon reminder is still to come for it
  fakeNow = NOON
  await run({})
  assert.deepEqual(sentTo(), ['p1@x'])
})

test('match-day time rule: once, at the time, to confirmed players only', async () => {
  seedClub()
  addRule({ id: 'noon', name: 'noon', trigger: 'matchDayAt', time: '12:00', audience: 'confirmed', text: '今天有球' })
  await run({})
  assert.equal(sends().length, 0, 'not yet')

  fakeNow = NOON
  await run({})
  await run({})
  assert.deepEqual(sentTo(), ['p1@x'], 'waitlist and guest rows skipped, no resend')
  const msg = sends()[0].data
  assert.equal(msg.data.templateData.thing4.value, '今天有球')
  assert.equal(msg.data.page, '/pages/match-detail/index?id=open')
  assert.equal(store.notifyLog.noon_open.sent, 1)
})

test('a time rule long past its moment is skipped, not sent late', async () => {
  seedClub()
  addRule({ id: 'early', name: 'early', trigger: 'matchDayAt', time: '09:00', audience: 'confirmed', text: 'x' })
  fakeNow = NOON
  await run({})
  assert.equal(sends().length, 0)
})

test('beforeKickoff rule + audiences', async () => {
  seedClub()
  addRule({ id: 'h2', name: 'h2', trigger: 'beforeKickoff', minutes: 120, audience: 'registered', text: 'x' })
  addRule({ id: 'nag', name: 'nag', trigger: 'beforeKickoff', minutes: 120, audience: 'unregistered_members', text: 'y' })
  fakeNow = KICKOFF - 119 * 60000
  await run({})
  const by = id => sends().filter(c => c.data.data.templateData.thing4.value === id).map(c => c.data.toOpenid).sort()
  assert.deepEqual(by('x'), ['p1@x', 'p2@x'])
  assert.deepEqual(by('y'), ['admin@x', 'p3@x', 'p4@x'], 'p3 only came as a guest row, so still counts as not registered')
})

test('disabled rules do nothing', async () => {
  seedClub()
  addRule({ id: 'noon', name: 'noon', enabled: false, trigger: 'matchDayAt', time: '12:00', audience: 'confirmed', text: 'x' })
  fakeNow = NOON
  await run({})
  assert.equal(sends().length, 0)
})

test('phase change by an admin runs the rules immediately', async () => {
  seedClub('registration_r1')
  as('admin@x')
  await updateMatchStatus({ matchId: 'open', status: 'registration_r2' })
  assert.ok(calls.some(c => c.name === 'runNotifyRules' && c.data.matchId === 'open'))

  // and the engine itself sends the R2 rule to unregistered 次卡
  calls.length = 0
  addRule({ id: 'r2', name: 'r2', trigger: 'phase', phase: 'registration_r2', audience: 'unregistered_per_session', text: 'R2' })
  await run({ matchId: 'open' })
  assert.deepEqual(sentTo(), ['p4@x'])
})

test('the cron hands broadcasts to the rule engine', async () => {
  seedClub()
  fakeNow = NOON
  await cron({})
  assert.ok(calls.some(c => c.name === 'runNotifyRules'))
  assert.equal(sends().filter(c => c.data.type === 'matchOpen').length, 0, 'no hard-coded broadcasts left in the cron')
})

test('admin CRUD validates and cleans up', async () => {
  seedClub()
  as('admin@x')
  await assert.rejects(admin({ action: 'save', rule: { name: 'a', text: '这是一段明显超过二十个字的通知文案内容会被拒绝', trigger: 'phase', phase: 'ready', audience: 'confirmed' } }), /20/)
  await assert.rejects(admin({ action: 'save', rule: { name: 'a', text: 'b', trigger: 'matchDayAt', time: '25:00', audience: 'confirmed' } }))
  const { id } = await admin({ action: 'save', rule: { name: '开球前提醒', text: '快开球了', trigger: 'beforeKickoff', minutes: 60, audience: 'confirmed' } })
  assert.equal(store.notifyRules[id].minutes, 60)

  await admin({ action: 'toggle', id, enabled: false })
  assert.equal(store.notifyRules[id].enabled, false)

  store.notifyLog[id + '_open'] = { ruleId: id, matchId: 'open', sent: 3, at: NOON }
  const { rules } = await admin({ action: 'list' })
  assert.deepEqual(rules.find(r => r.id === id).lastSent, { at: NOON, sent: 3 })

  await admin({ action: 'delete', id })
  assert.equal(store.notifyRules[id], undefined)
  assert.equal(store.notifyLog[id + '_open'], undefined)

  as('p1@x')
  await assert.rejects(admin({ action: 'list' }), /admins only/)
})
