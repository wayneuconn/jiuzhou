// A tag added after the fact must reach matches the player has ALREADY joined.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, store, calls, as, seed, gkReg } = require('./harness')

const updateMatchStatus = load('updateMatchStatus')

// The player is on the roster of the upcoming match before the tag is applied
function seedSignedUp(extra = {}) {
  seed({
    users: {
      p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', ...extra.p1 },
      p2: { openid: 'p2@x', role: 'member', displayName: '李四', membershipType: 'annual', ...extra.p2 },
      capA: { openid: 'capA@x', role: 'member', displayName: '队长A', membershipType: 'annual' },
    },
    matches: {
      played: { status: 'completed', date: Date.now() + 7 * 864e5, maxPlayers: 22, location: '球场' },
      open: { status: 'drafting', date: Date.now() + 7 * 864e5, maxPlayers: 22, location: '球场', captainA: 'capA' },
      ...extra.matches,
    },
    registrations: {
      played_p1: { matchId: 'played', uid: 'p1', displayName: '张三', status: 'confirmed', tags: [] },
      open_p1: { matchId: 'open', uid: 'p1', displayName: '张三', status: 'confirmed', team: 'A' },
      ...extra.registrations,
    },
  })
}

const tag = (uid, tags) => updateMatchStatus({ action: 'toggleTag', matchId: 'played', uid, tags })

test('旷赛 tag reaches a match the player already signed up for', async () => {
  seedSignedUp()
  await tag('p1', ['absent'])

  const reg = store.registrations.open_p1
  assert.equal(reg.gkPenalty, true, 'duty attached to the existing registration')
  assert.equal(reg.gkHalves, 1, 'half a match — they never got to choose 全场')
  assert.equal(reg.gkReason, 'absent')
  assert.equal(reg.gkAuto, true, 'marked as assigned, not claimed')
})

test('the existing spot is never disturbed', async () => {
  seedSignedUp()
  await tag('p1', ['absent'])

  const reg = store.registrations.open_p1
  assert.equal(reg.status, 'confirmed', 'still on the roster')
  assert.equal(reg.team, 'A', 'still on their team')
})

test('player, captain and admins are all told', async () => {
  seedSignedUp()
  await tag('p1', ['absent'])

  const sent = calls.filter(c => c.name === 'sendSubscribeMsg').map(c => c.data.toOpenid)
  assert.ok(sent.includes('p1@x'), 'the player')
  assert.ok(sent.includes('capA@x'), "this match's captain")
  assert.ok(sent.includes('admin@x'), 'the admins')
})

test('迟到 attaches only once the tally crosses the threshold', async () => {
  seedSignedUp({ p1: { lateCount: 1, lateCountTotal: 1 } }) // threshold is 3
  await tag('p1', ['late'])
  assert.ok(!store.registrations.open_p1.gkPenalty, 'second late: nothing yet')

  await tag('p1', [])
  seedSignedUp({ p1: { lateCount: 2, lateCountTotal: 2 } })
  await tag('p1', ['late'])
  assert.equal(store.registrations.open_p1.gkPenalty, true, 'third late crosses it')
  assert.equal(store.registrations.open_p1.gkReason, 'late')
  assert.equal(store.registrations.open_p1.gkAuto, true)
})

test('untagging takes the assigned duty back', async () => {
  seedSignedUp()
  await tag('p1', ['absent'])
  await tag('p1', [])

  const reg = store.registrations.open_p1
  assert.equal(reg.gkPenalty, false, 'duty withdrawn with the tag')
  assert.equal(store.users.p1.gkHalvesOwed, 0, 'and the debt refunded')
  assert.equal(reg.status, 'confirmed', 'spot still untouched')
})

test('untagging never takes back a duty the player claimed at signup', async () => {
  seedSignedUp()
  // Claimed deliberately at signup — no gkAuto flag
  store.registrations.open_p1 = gkReg('open', 'p1', '张三', { halves: 2 })
  store.users.p1.gkHalvesOwed = 2

  await tag('p1', ['absent'])   // a second absence
  await tag('p1', [])           // ...undone
  assert.equal(store.registrations.open_p1.gkPenalty, true, 'the claimed duty stands')
  assert.equal(store.registrations.open_p1.gkHalves, 2)
})

test('skips a match whose GK slots are already full', async () => {
  seedSignedUp({
    registrations: { open_p2: gkReg('open', 'p2', '李四', { halves: 2 }) },
  })
  await tag('p1', ['absent'])

  assert.ok(!store.registrations.open_p1.gkPenalty, 'no room this match')
  assert.equal(store.users.p1.gkHalvesOwed, 2, 'debt kept for a later match')
})

test('does not touch matches already played or cancelled', async () => {
  seedSignedUp({
    matches: {
      open: { status: 'cancelled', date: Date.now() + 7 * 864e5, maxPlayers: 22 },
    },
  })
  await tag('p1', ['absent'])
  assert.ok(!store.registrations.open_p1.gkPenalty, 'cancelled match is out of scope')
})

test('reaches a waitlisted signup too', async () => {
  seedSignedUp({
    registrations: {
      open_p1: { matchId: 'open', uid: 'p1', displayName: '张三', status: 'waitlist', waitlistPosition: 1 },
    },
  })
  await tag('p1', ['absent'])

  assert.equal(store.registrations.open_p1.gkPenalty, true, 'duty rides along if they get promoted')
  assert.equal(store.registrations.open_p1.status, 'waitlist', 'queue position untouched')
})

test('attaches to every pending match they are in', async () => {
  seedSignedUp({
    matches: { later: { status: 'registration_r2', date: Date.now() + 14 * 864e5, maxPlayers: 22 } },
    registrations: { later_p1: { matchId: 'later', uid: 'p1', displayName: '张三', status: 'confirmed' } },
  })
  await tag('p1', ['absent'])

  assert.equal(store.registrations.open_p1.gkPenalty, true)
  assert.equal(store.registrations.later_p1.gkPenalty, true)
})

test('an assigned half can still be signed off as a whole match', async () => {
  seedSignedUp()
  await tag('p1', ['absent'])
  assert.equal(store.users.p1.gkHalvesOwed, 2)

  // Captain says they actually kept goal the whole match
  await updateMatchStatus({ action: 'clearGkPenalty', matchId: 'open', uid: 'p1', halves: 2 })
  assert.equal(store.users.p1.gkHalvesOwed, 0, 'debt settled in one go despite the 1-half assignment')
})
