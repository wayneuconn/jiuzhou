// 夏/冬令时切换日：开球时间、12:00 截止线、当天提醒都必须落在正确的 ET 整点。
// 2026-11-01 02:00 退回 EST，2026-03-08 02:00 进入 EDT。
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { load, store, as, seed } = require('./harness')
const createMatch = load('createMatch')
const updateMatchStatus = load('updateMatchStatus')
const runNotifyRules = load('runNotifyRules')

const et = ts => new Date(ts).toLocaleString('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

const KICKOFFS = [
  ['2026-11-01', '20:00', '11/01/2026, 20:00'],   // fall back, same day
  ['2026-03-08', '20:00', '03/08/2026, 20:00'],   // spring forward, same day
  ['2026-10-25', '20:00', '10/25/2026, 20:00'],   // plain EDT Sunday
  ['2026-11-08', '20:00', '11/08/2026, 20:00'],   // plain EST Sunday
  ['2026-11-01', '09:30', '11/01/2026, 09:30'],   // before the 02:00 switch-back
]

test('createMatch 的开球时间在切换日也是 ET 原值', async () => {
  for (const [dateStr, timeStr, want] of KICKOFFS) {
    seed()
    const { matchId } = await createMatch({ dateStr, timeStr })
    assert.equal(et(store.matches[matchId].date), want, `${dateStr} ${timeStr}`)
  }
})

test('editMatch 改期后同样落在 ET 原值', async () => {
  for (const [dateStr, timeStr, want] of KICKOFFS) {
    seed()
    await updateMatchStatus({ action: 'editMatch', matchId: 'open', dateStr, timeStr })
    assert.equal(et(store.matches.open.date), want, `${dateStr} ${timeStr}`)
  }
})

// 12:00 截止线：11:59 还能自动递补，12:01 就停。切换日曾经提前一小时在 11:00 生效。
test('比赛当天 12:00 截止线不被切换日提前', async () => {
  const RealDate = Date
  const kickoff = RealDate.parse('2026-11-02T01:00:00Z')   // 2026-11-01 20:00 EST
  const at = iso => {
    const t = RealDate.parse(iso)
    global.Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [t])) }
      static now() { return t }
    }
  }
  try {
    for (const [iso, promoted] of [
      ['2026-11-01T16:30:00Z', true],    // 11:30 EST
      ['2026-11-01T17:30:00Z', false],   // 12:30 EST
    ]) {
      at(iso)
      seed({
        matches: { open: { status: 'registration_r2', date: kickoff, maxPlayers: 1, location: '球场' } },
        registrations: {
          open_p1: { matchId: 'open', uid: 'p1', displayName: '张三', status: 'confirmed', tags: [] },
          open_p2: { matchId: 'open', uid: 'p2', displayName: '李四', status: 'waitlist', waitlistTier: 1, waitlistPosition: 1, tags: [] },
        },
      })
      as('p1@x')
      await load('withdrawFromMatch')({ matchId: 'open' })
      assert.equal(store.registrations.open_p2.status === 'waitlist', !promoted, iso)
    }
  } finally {
    global.Date = RealDate
  }
})

// 「比赛当天 12:00 提醒」同理：切换日曾在 11:00 就发出去。
test('当天定时提醒按 ET 12:00 触发', async () => {
  const RealDate = Date
  const kickoff = RealDate.parse('2026-11-02T01:00:00Z')
  const run = async iso => {
    const t = RealDate.parse(iso)
    global.Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [t])) }
      static now() { return t }
    }
    seed({
      config: { notifyRulesSeeded: true },
      matches: { open: { status: 'registration_r2', date: kickoff, maxPlayers: 22, location: '球场' } },
      registrations: { open_p1: { matchId: 'open', uid: 'p1', displayName: '张三', status: 'confirmed', tags: [] } },
    })
    store.notifyRules = {
      noon: { name: '比赛当天中午提醒', enabled: true, trigger: 'matchDayAt', time: '12:00', audience: 'confirmed', text: '今天有球' },
    }
    const res = await runNotifyRules({})
    return (res.sent ?? 0) > 0
  }
  try {
    assert.equal(await run('2026-11-01T16:05:00Z'), false, '11:05 EST 不该发')
    assert.equal(await run('2026-11-01T17:05:00Z'), true, '12:05 EST 应该发')
  } finally {
    global.Date = RealDate
  }
})
