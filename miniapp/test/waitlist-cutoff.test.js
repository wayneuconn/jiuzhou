// 比赛当天 12:00 之后，队列只在尾部增长：
//   - 12:00 之前报名的，顺序就此定格，不再因为任何人的加入而改变
//   - 12:00 之后报名的一律按先来后到追加，是不是年卡不再影响位置
const { test } = require('node:test')
const assert = require('node:assert/strict')

const RealDate = Date
let fakeNow = 0
global.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [fakeNow])) }
  static now() { return fakeNow }
}

const { load, store, as, seed } = require('./harness')
const register = load('registerForMatch')
const withdraw = load('withdrawFromMatch')

const KICKOFF = RealDate.parse('2026-11-09T01:00:00Z')   // 2026-11-08 20:00 EST
const BEFORE = RealDate.parse('2026-11-08T16:30:00Z')    // 11:30 EST
const AFTER = RealDate.parse('2026-11-08T17:30:00Z')     // 12:30 EST

// 排队顺序：先到的在前（未迟到组按 tier，迟到组只看先后）
function queue() {
  return Object.entries(store.registrations)
    .map(([_id, r]) => ({ _id, ...r }))
    .filter(r => r.status === 'waitlist')
    .sort((a, b) => {
      const aL = a.waitlistLate === true, bL = b.waitlistLate === true
      return (aL ? 1 : 0) - (bL ? 1 : 0)
        || (aL ? 0 : (a.waitlistTier ?? 1) - (b.waitlistTier ?? 1))
        || (a.waitlistPosition ?? 99) - (b.waitlistPosition ?? 99)
    })
    .map(r => r.displayName)
}

// 名单已满的一场，候补从空开始
function seedFull(at) {
  fakeNow = at
  seed({
    users: {
      admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual' },
      a1: { openid: 'a1@x', role: 'member', displayName: '年卡A', membershipType: 'annual' },
      a2: { openid: 'a2@x', role: 'member', displayName: '年卡B', membershipType: 'annual' },
      s1: { openid: 's1@x', role: 'member', displayName: '次卡A', membershipType: 'per_session' },
      s2: { openid: 's2@x', role: 'member', displayName: '次卡B', membershipType: 'per_session' },
      f1: { openid: 'f1@x', role: 'member', displayName: '占位', membershipType: 'annual' },
    },
    matches: { open: { status: 'registration_r2', date: KICKOFF, maxPlayers: 1, location: '球场' } },
    registrations: {
      open_f1: { matchId: 'open', uid: 'f1', displayName: '占位', status: 'confirmed', tags: [] },
    },
  })
}

const signUp = async (openid, at) => { fakeNow = at; as(openid); await register({ matchId: 'open' }) }

test('12:00 前：年卡插在次卡之前（原有规则不变）', async () => {
  seedFull(BEFORE)
  await signUp('s1@x', BEFORE)
  await signUp('a1@x', BEFORE + 60000)
  assert.deepEqual(queue(), ['年卡A', '次卡A'])
})

test('12:00 后报名的追加到队尾，年卡也不插队', async () => {
  seedFull(BEFORE)
  await signUp('s1@x', BEFORE)            // 次卡，准时
  await signUp('a1@x', AFTER)             // 年卡，迟到
  assert.deepEqual(queue(), ['次卡A', '年卡A'])
})

test('12:00 后的多人之间只看先后，不看卡种', async () => {
  seedFull(BEFORE)
  await signUp('s1@x', AFTER)             // 次卡先
  await signUp('a1@x', AFTER + 60000)     // 年卡后
  assert.deepEqual(queue(), ['次卡A', '年卡A'])
})

test('12:00 后再有人报名，不会打乱 12:00 前已排好的顺序', async () => {
  seedFull(BEFORE)
  await signUp('s1@x', BEFORE)            // 次卡，10:00
  await signUp('a1@x', BEFORE + 60000)    // 年卡，10:01 → 插到次卡前
  assert.deepEqual(queue(), ['年卡A', '次卡A'])
  await signUp('a2@x', AFTER)             // 年卡，13:00
  await signUp('s2@x', AFTER + 60000)     // 次卡，13:01
  assert.deepEqual(queue(), ['年卡A', '次卡A', '年卡B', '次卡B'])
})

test('退出再报名：12:00 后回来就排到队尾', async () => {
  seedFull(BEFORE)
  await signUp('a1@x', BEFORE)
  await signUp('s1@x', BEFORE + 60000)
  assert.deepEqual(queue(), ['年卡A', '次卡A'])

  fakeNow = AFTER
  as('a1@x')
  await withdraw({ matchId: 'open' })
  await signUp('a1@x', AFTER + 60000)
  assert.deepEqual(queue(), ['次卡A', '年卡A'])
})

test('12:00 后带的朋友也排在队尾', async () => {
  seedFull(BEFORE)
  await signUp('s1@x', BEFORE)
  fakeNow = AFTER
  as('f1@x')                              // 名单内的年卡会员带朋友
  await register({ matchId: 'open', friendName: '朋友', friendPositions: ['ST'] })
  assert.deepEqual(queue(), ['次卡A', '朋友'])
})
