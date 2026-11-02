// 先到先得 options on a form question — one taker per option.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, store, as, reset } = require('./harness')

const saveEvent = load('adminSaveEvent')
const joinEvent = load('joinEvent')
const eventDetail = load('getEventDetail')

const NUMBERS = {
  id: 'kit', title: '球衣号码', type: 'single',
  options: ['7', '9', '10'], required: true, exclusive: true,
}

function seedClub() {
  reset()
  store.users = {
    admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual' },
    a1: { openid: 'a1@x', role: 'member', displayName: '张三', membershipType: 'annual' },
    a2: { openid: 'a2@x', role: 'member', displayName: '李四', membershipType: 'annual' },
  }
  as('admin@x')
}

async function openEvent(questions = [NUMBERS]) {
  const { eventId } = await saveEvent({ title: '订队服', scope: 'all', questions })
  await saveEvent({ action: 'setStatus', eventId, status: 'open' })
  return eventId
}

const claims = () => Object.values(store.eventClaims || {})
const holderOf = (option) => claims().find(c => c.option === option)?.displayName ?? ''

test('an exclusive question gets one claim row per option', async () => {
  seedClub()
  await openEvent()
  assert.equal(claims().length, 3)
  assert.deepEqual(claims().map(c => c.option).sort(), ['10', '7', '9'])
  assert.ok(claims().every(c => c.uid === null))
})

test('first-round questions never become exclusive', async () => {
  seedClub()
  const { eventId } = await saveEvent({
    title: '聚餐', scope: 'all',
    prepQuestions: [{ ...NUMBERS, id: 'day', title: '哪天' }],
  })
  assert.equal(store.events[eventId].prepQuestions[0].exclusive, false)
  assert.equal(claims().length, 0)
})

test('the first player takes a number, the second is turned away by name', async () => {
  seedClub()
  const eventId = await openEvent()

  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } })
  assert.equal(holderOf('10'), '张三')

  as('a2@x')
  await assert.rejects(
    () => joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } }),
    /「10」刚被人选走了/,
  )
  assert.equal(store.eventRegistrations[eventId + '_a2'], undefined)
})

test('a free number still goes through', async () => {
  seedClub()
  const eventId = await openEvent()

  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } })
  as('a2@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '7' } })

  assert.equal(holderOf('10'), '张三')
  assert.equal(holderOf('7'), '李四')
  assert.equal(store.eventRegistrations[eventId + '_a2'].answers.kit, '7')
})

test('switching numbers frees the old one for someone else', async () => {
  seedClub()
  const eventId = await openEvent()

  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } })
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '9' } })
  assert.equal(holderOf('10'), '')
  assert.equal(holderOf('9'), '张三')

  as('a2@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } })
  assert.equal(holderOf('10'), '李四')
})

test('withdrawing releases the number', async () => {
  seedClub()
  const eventId = await openEvent()

  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } })
  await joinEvent({ eventId, mode: 'withdraw' })
  assert.equal(holderOf('10'), '')

  as('a2@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } })
  assert.equal(holderOf('10'), '李四')
})

test('re-saving the same answer is not a self-collision', async () => {
  seedClub()
  const eventId = await openEvent()
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } })
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } })
  assert.equal(holderOf('10'), '张三')
})

test('everyone sees who holds what, and which one is theirs', async () => {
  seedClub()
  const eventId = await openEvent()
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } })

  as('a2@x')
  const seen = await eventDetail({ eventId })
  assert.deepEqual(seen.exclusiveTaken.kit['10'], { name: '张三', mine: false })
  assert.equal(seen.exclusiveTaken.kit['7'], undefined)

  as('a1@x')
  const mine = await eventDetail({ eventId })
  assert.equal(mine.exclusiveTaken.kit['10'].mine, true)
})

test('editing the options keeps taken numbers and drops the untouched ones', async () => {
  seedClub()
  const eventId = await openEvent()
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } })

  as('admin@x')
  await saveEvent({
    eventId, title: '订队服', scope: 'all',
    questions: [{ ...NUMBERS, options: ['10', '11'] }],
  })

  assert.deepEqual(claims().map(c => c.option).sort(), ['10', '11'])
  assert.equal(holderOf('10'), '张三')
})
