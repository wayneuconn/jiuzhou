// The generic form: one round by default, number questions, roster visibility.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, store, as, reset } = require('./harness')

const saveEvent = load('adminSaveEvent')
const joinEvent = load('joinEvent')
const detail = load('getEventDetail')

const GUESTS = { id: 'g', title: '带几位家属', type: 'number', options: [], required: false, max: 2, countsSeats: true }
const SHIRTS = { id: 's', title: '订几件队服', type: 'number', options: [], required: false, max: 5 }

function seedClub() {
  reset()
  store.users = {
    admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual' },
    a1: { openid: 'a1@x', role: 'member', displayName: '张三', membershipType: 'annual' },
    a2: { openid: 'a2@x', role: 'member', displayName: '李四', membershipType: 'annual' },
    a3: { openid: 'a3@x', role: 'member', displayName: '王五', membershipType: 'annual' },
  }
  as('admin@x')
}

async function open(extra = {}) {
  const { eventId } = await saveEvent({
    title: '表单', scope: 'all',
    questions: [{ id: 'q1', title: '来吗', type: 'single', options: ['来', '不来'], required: true }],
    ...extra,
  })
  await saveEvent({ action: 'setStatus', eventId, status: 'open' })
  return eventId
}

test('a form with no first round goes straight from draft to open', async () => {
  seedClub()
  const { eventId } = await saveEvent({
    title: '招新', scope: 'all',
    questions: [{ id: 'q1', title: '来吗', type: 'single', options: ['来', '不来'], required: true }],
  })
  assert.equal(store.events[eventId].status, 'draft')
  assert.deepEqual(store.events[eventId].prepQuestions, [])

  await saveEvent({ action: 'setStatus', eventId, status: 'open' })
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { q1: '来' } })
  assert.equal(store.eventRegistrations[eventId + '_a1'].status, 'submitted')
})

test('a form needs at least one question', async () => {
  seedClub()
  await assert.rejects(() => saveEvent({ title: '空的', scope: 'all' }), /至少要有一道问题/)
})

test('actionLabel defaults to 提交 and is kept when set', async () => {
  seedClub()
  const a = await open()
  assert.equal(store.events[a].actionLabel, '提交')
  const b = await open({ actionLabel: '报名' })
  assert.equal(store.events[b].actionLabel, '报名')
})

test('a number answer is clamped to the question max', async () => {
  seedClub()
  const eventId = await open({ questions: [SHIRTS] })
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { s: 99 } })
  assert.equal(store.eventRegistrations[eventId + '_a1'].answers.s, 5)
})

test('only a countsSeats number eats into the headcount cap', async () => {
  seedClub()
  const eventId = await open({ questions: [GUESTS, SHIRTS], maxAttendees: 4 })

  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { g: 2, s: 5 } })
  as('a2@x')
  await assert.rejects(
    () => joinEvent({ eventId, mode: 'submit', answers: { g: 2 } }),
    /仅剩 1 个位置/,
  )
  await joinEvent({ eventId, mode: 'submit', answers: { g: 0, s: 3 } })

  as('admin@x')
  const seen = await detail({ eventId })
  assert.equal(seen.submittedCount, 2)
  assert.equal(seen.headcount, 4)
})

test('withdrawing frees the seats it was holding', async () => {
  seedClub()
  const eventId = await open({ questions: [GUESTS], maxAttendees: 3 })
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { g: 2 } })
  as('a2@x')
  await assert.rejects(() => joinEvent({ eventId, mode: 'submit', answers: { g: 1 } }), /名额不足/)
  as('a1@x')
  await joinEvent({ eventId, mode: 'withdraw' })
  as('a2@x')
  await joinEvent({ eventId, mode: 'submit', answers: { g: 1 } })
  assert.equal(store.eventRegistrations[eventId + '_a2'].status, 'submitted')
})

test('rosterVisibility names shows everyone, count hides the names, none hides both', async () => {
  seedClub()
  for (const [visibility, expectRoster, expectCount] of [['names', 2, 2], ['count', 0, 2], ['none', 0, null]]) {
    const eventId = await open({ rosterVisibility: visibility })
    as('a1@x'); await joinEvent({ eventId, mode: 'submit', answers: { q1: '来' } })
    as('a2@x'); await joinEvent({ eventId, mode: 'submit', answers: { q1: '来' } })

    as('a3@x')
    const seen = await detail({ eventId })
    assert.equal(seen.roster.length, expectRoster, visibility)
    assert.equal(seen.submittedCount, expectCount, visibility)
    as('admin@x')
  }
})

test('an admin still sees the roster when it is hidden from everyone else', async () => {
  seedClub()
  const eventId = await open({ rosterVisibility: 'none' })
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { q1: '来' } })
  as('admin@x')
  const seen = await detail({ eventId })
  assert.equal(seen.roster.length, 1)
  assert.equal(seen.submittedCount, 1)
})

test('the first round is a separate submission that does not count as submitted', async () => {
  seedClub()
  const { eventId } = await saveEvent({
    title: '队庆', scope: 'all',
    prepQuestions: [{ id: 'd', title: '哪天', type: 'single', options: ['周六', '周日'], required: true }],
    questions: [{ id: 'q1', title: '来吗', type: 'single', options: ['来', '不来'], required: true }],
  })
  await saveEvent({ action: 'setStatus', eventId, status: 'prep' })

  as('a1@x')
  await joinEvent({ eventId, mode: 'prep', prepAnswers: { d: '周日' } })
  assert.equal(store.eventRegistrations[eventId + '_a1'].status, 'prepped')
  await assert.rejects(() => joinEvent({ eventId, mode: 'submit', answers: { q1: '来' } }), /还没开放/)

  as('admin@x')
  await saveEvent({ action: 'setStatus', eventId, status: 'open' })
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { q1: '来' } })
  const r = store.eventRegistrations[eventId + '_a1']
  assert.equal(r.status, 'submitted')
  assert.equal(r.prepAnswers.d, '周日')
  assert.equal(r.answers.q1, '来')
})

test('the open notification uses the form own verb', async () => {
  seedClub()
  const { calls } = require('./harness')
  const eventId = await open({ actionLabel: '报名' })
  const texts = calls.filter(c => c.name === 'sendSubscribeMsg').map(c => c.data.data.templateData.thing4.value)
  assert.ok(texts.includes('开放报名了'), texts.join('|'))
})
