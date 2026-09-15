// 旷赛/迟到 门将义务 accounting, end to end through the real cloud functions.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, store, calls, as, seed, gkReg } = require('./harness')

const updateMatchStatus = load('updateMatchStatus')
const registerForMatch = load('registerForMatch')

const tagAbsent = (uid, on = true) =>
  updateMatchStatus({ action: 'toggleTag', matchId: 'played', uid, tags: on ? ['absent'] : [] })
const signOff = (matchId, uid, halves) =>
  updateMatchStatus({ action: 'clearGkPenalty', matchId, uid, halves })
const signUp = (openid, gkHalves) => { as(openid); return registerForMatch({ matchId: 'open', gkHalves }) }

test('缺席 books GK halves instead of a ban', async () => {
  seed({ registrations: { played_p1: { matchId: 'played', uid: 'p1', displayName: '张三', status: 'confirmed', tags: [] } } })

  await tagAbsent('p1')
  assert.equal(store.users.p1.gkHalvesOwed, 2, 'owes one full match in goal')
  assert.equal(store.users.p1.absentCount, 1, 'lifetime tally')
  assert.equal(store.users.p1.banGamesLeft, undefined, 'no ban is issued any more')
  assert.ok(calls.some(c => c.name === 'sendSubscribeMsg'), 'player is told what they owe')
})

test('untagging 缺席 refunds the debt', async () => {
  seed({ registrations: { played_p1: { matchId: 'played', uid: 'p1', displayName: '张三', status: 'confirmed', tags: [] } } })

  await tagAbsent('p1')
  await tagAbsent('p1', false)
  assert.equal(store.users.p1.gkHalvesOwed, 0)
  assert.equal(store.users.p1.absentCount, 0)
})

test('absentGkHalves = 0 disables the penalty', async () => {
  seed({
    config: { absentGkHalves: 0 },
    registrations: { played_p1: { matchId: 'played', uid: 'p1', displayName: '张三', status: 'confirmed', tags: [] } },
  })

  await tagAbsent('p1')
  assert.equal(store.users.p1.gkHalvesOwed ?? 0, 0, 'no debt booked')
  assert.equal(store.users.p1.absentCount, 1, 'but the absence is still on record')
})

test('signup: claiming a whole match books both halves', async () => {
  seed({ users: { p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', gkHalvesOwed: 2 } } })

  const res = await signUp('p1@x', 2)
  assert.deepEqual([res.gkPenalty, res.gkHalves, res.gkReason], [true, 2, 'absent'])
  assert.equal(store.registrations.open_p1.gkHalves, 2, 'the claim is recorded on the registration')
})

test('signup: one whole match fills the slot, so the next player carries on', async () => {
  seed({
    users: {
      p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', gkHalvesOwed: 2 },
      p2: { openid: 'p2@x', role: 'member', displayName: '李四', membershipType: 'annual', gkHalvesOwed: 2 },
    },
  })

  await signUp('p1@x', 2)
  const res = await signUp('p2@x', 2)
  assert.deepEqual([res.gkPenalty, res.gkHalves], [false, 0], 'no duty available this match')
  assert.equal(store.users.p2.gkHalvesOwed, 2, 'debt is untouched, not forgiven')
})

test('signup: two players at a half each also fill the match', async () => {
  seed({
    users: {
      p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', gkHalvesOwed: 2 },
      p2: { openid: 'p2@x', role: 'member', displayName: '李四', membershipType: 'annual', gkHalvesOwed: 2 },
      p3: { openid: 'p3@x', role: 'member', displayName: '王五', membershipType: 'annual', gkHalvesOwed: 2 },
    },
  })

  assert.equal((await signUp('p1@x', 1)).gkHalves, 1)
  assert.equal((await signUp('p2@x', 2)).gkHalves, 1, 'asked for a whole match, only a half was left')
  assert.equal((await signUp('p3@x', 1)).gkPenalty, false, 'shut out; duty carries to a later match')
})

test('signup: you can never claim more halves than you owe', async () => {
  seed({ users: { p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', gkHalvesOwed: 1 } } })

  const res = await signUp('p1@x', 2)
  assert.equal(res.gkHalves, 1, 'a 1-half debt buys a half, whatever the client asks for')
})

test('sign-off records halves actually served, not halves claimed', async () => {
  seed({
    users: { p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', gkHalvesOwed: 2 } },
    registrations: { played_p1: gkReg('played', 'p1', '张三', { halves: 2 }) },
  })

  await signOff('played', 'p1', 1)
  assert.equal(store.users.p1.gkHalvesOwed, 1, 'promised a whole match, kept goal for one half')
  assert.equal(store.registrations.played_p1.gkPenalty, false, 'duty closed for this match')
  assert.equal(store.registrations.played_p1.gkHalvesServed, 1)
})

test('sign-off: a whole match settles a two-half debt at once', async () => {
  seed({
    users: { p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', gkHalvesOwed: 2 } },
    registrations: { played_p1: gkReg('played', 'p1', '张三', { halves: 2 }) },
  })

  await signOff('played', 'p1', 2)
  assert.equal(store.users.p1.gkHalvesOwed, 0)
})

test('the leftover half can be served at a later match', async () => {
  seed({
    users: { p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', gkHalvesOwed: 2 } },
    registrations: { played_p1: gkReg('played', 'p1', '张三', { halves: 1 }) },
  })

  await signOff('played', 'p1', 1)
  assert.equal(store.users.p1.gkHalvesOwed, 1)

  const res = await signUp('p1@x', 1)
  assert.deepEqual([res.gkHalves, res.gkReason], [1, 'absent'])
  as('admin@x')
  await signOff('open', 'p1', 1)
  assert.equal(store.users.p1.gkHalvesOwed, 0, 'debt cleared across two matches')
})

test('迟到 duty still works and stays a single half', async () => {
  seed({ users: { p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', lateCount: 3, lateCountTotal: 3 } } })

  const res = await signUp('p1@x')
  assert.deepEqual([res.gkPenalty, res.gkHalves, res.gkReason], [true, 1, 'late'])

  as('admin@x')
  await signOff('open', 'p1', 1)
  assert.equal(store.users.p1.lateCount, 0, 'current tally zeroed')
  assert.equal(store.users.p1.lateCountTotal, 3, 'lifetime record kept')
})

test('旷赛 debt outranks the 迟到 threshold', async () => {
  seed({ users: { p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', lateCount: 3, gkHalvesOwed: 2 } } })

  const res = await signUp('p1@x', 2)
  assert.deepEqual([res.gkReason, res.gkHalves], ['absent', 2])

  as('admin@x')
  await signOff('open', 'p1', 2)
  assert.equal(store.users.p1.gkHalvesOwed, 0, 'absence paid off')
  assert.equal(store.users.p1.lateCount, 3, 'late duty waits for a later match')
})

test('迟到 and 旷赛 duties share the two-half budget', async () => {
  seed({
    users: {
      p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', gkHalvesOwed: 2 },
      p2: { openid: 'p2@x', role: 'member', displayName: '李四', membershipType: 'annual', lateCount: 3 },
    },
  })

  assert.equal((await signUp('p1@x', 2)).gkHalves, 2, 'one player takes the whole match')
  assert.equal((await signUp('p2@x')).gkPenalty, false, 'no room left for the late-arrival half')
})

test('a ban is still a ban', async () => {
  seed({ users: { p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', banGamesLeft: 2 } } })

  await assert.rejects(() => signUp('p1@x'), /禁赛/)
})

test('rows and action name from before the rule change still work', async () => {
  seed({
    users: { p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', lateCount: 3 } },
    // No gkHalves/gkReason: written by the pre-旷赛-rule build
    registrations: { played_p1: { matchId: 'played', uid: 'p1', displayName: '张三', status: 'confirmed', gkPenalty: true } },
  })

  await updateMatchStatus({ action: 'clearLatePenalty', matchId: 'played', uid: 'p1' })
  assert.equal(store.users.p1.lateCount, 0, 'legacy row treated as a 迟到 duty')
})

test('withdrawing frees the GK slot for someone else', async () => {
  seed({
    users: {
      p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', gkHalvesOwed: 2 },
      p2: { openid: 'p2@x', role: 'member', displayName: '李四', membershipType: 'annual', gkHalvesOwed: 2 },
    },
  })
  const withdrawFromMatch = load('withdrawFromMatch')

  await signUp('p1@x', 2)
  as('p1@x')
  await withdrawFromMatch({ matchId: 'open' })

  const res = await signUp('p2@x', 2)
  assert.equal(res.gkHalves, 2, 'the whole match is available again')
})
