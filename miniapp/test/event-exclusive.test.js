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

test('no claim rows exist until someone actually picks', async () => {
  seedClub()
  await openEvent()
  assert.equal(claims().length, 0)
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
    /「10」已经有人了/,
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

test('editing the options leaves a taken number taken', async () => {
  seedClub()
  const eventId = await openEvent()
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } })

  as('admin@x')
  await saveEvent({
    eventId, title: '订队服', scope: 'all',
    questions: [{ ...NUMBERS, options: ['10', '11'] }],
  })

  assert.equal(holderOf('10'), '张三')
  as('a2@x')
  await assert.rejects(() => joinEvent({ eventId, mode: 'submit', answers: { kit: '10' } }), /已经有人了/)
})

// 不能重复 on a free-text question: type your own number.
const KIT_TEXT = { id: 'kit', title: '球衣号码', type: 'text', options: [], required: true, exclusive: true }

test('a text question can be exclusive; a single one still can, a multi one cannot', async () => {
  seedClub()
  const { eventId } = await saveEvent({
    title: 'x', scope: 'all',
    questions: [KIT_TEXT, { ...NUMBERS, id: 'm', type: 'multi' }, { id: 'n', title: '件数', type: 'number', max: 3, exclusive: true }],
  })
  const qs = store.events[eventId].questions
  assert.equal(qs[0].exclusive, true)
  assert.equal(qs[1].exclusive, undefined)
  assert.equal(qs[2].exclusive, undefined)
})

test('typed numbers collide after normalising, so 07 and 7 are the same', async () => {
  seedClub()
  const eventId = await openEvent([KIT_TEXT])
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: ' 07 ' } })
  assert.equal(store.eventRegistrations[eventId + '_a1'].answers.kit, '7')

  as('a2@x')
  await assert.rejects(() => joinEvent({ eventId, mode: 'submit', answers: { kit: '7' } }), /「7」已经有人了/)
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '77' } })
  assert.equal(holderOf('77'), '李四')
})

test('00 stays distinct from 0', async () => {
  seedClub()
  const eventId = await openEvent([KIT_TEXT])
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '0' } })
  as('a2@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '00' } })
  assert.equal(holderOf('0'), '张三')
  assert.equal(holderOf('00'), '李四')
})

test('changing a typed number frees the old one', async () => {
  seedClub()
  const eventId = await openEvent([KIT_TEXT])
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '23' } })
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '24' } })
  as('a2@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '23' } })
  assert.equal(holderOf('23'), '李四')
  assert.equal(holderOf('24'), '张三')
})

test('everyone sees the taken typed numbers; ordinary text answers stay private', async () => {
  seedClub()
  const eventId = await openEvent([KIT_TEXT, { id: 'note', title: '备注', type: 'text', options: [], required: false }])
  as('a1@x')
  await joinEvent({ eventId, mode: 'submit', answers: { kit: '10', note: '左脚' } })

  as('a2@x')
  const seen = await eventDetail({ eventId })
  assert.deepEqual(seen.exclusiveTaken.kit['10'], { name: '张三', mine: false })
  assert.equal(seen.exclusiveTaken.note, undefined)
  assert.equal(JSON.stringify(seen).includes('左脚'), false)
})
