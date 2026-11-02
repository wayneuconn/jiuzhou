// 活动 → 通用表单 migration: field renames plus 家属 becoming a number question.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, store, as, reset } = require('./harness')

const migrate = load('migrateEvents')

function seedOldWorld() {
  reset()
  store.users = { admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual' } }
  store.events = {
    dinner: {
      title: '队庆', scope: 'annual', status: 'registration',
      allowGuests: true, maxGuestsPer: 2,
      pollQuestions: [{ id: 'd', title: '哪天', type: 'single', options: ['周六', '周日'], required: true }],
      signupQuestions: [{ id: 'f', title: '忌口', type: 'text', options: [], required: false }],
    },
    survey: {
      title: '意向调查', scope: 'annual', status: 'polling',
      allowGuests: false, maxGuestsPer: 2,
      pollQuestions: [{ id: 'w', title: '哪周', type: 'multi', options: ['12.6', '12.13'], required: true }],
      signupQuestions: [],
    },
  }
  store.eventRegistrations = {
    dinner_a1: { eventId: 'dinner', uid: 'a1', displayName: '张三', status: 'confirmed', guests: 2, guestNames: '夫人+娃', pollAnswers: { d: '周日' }, signupAnswers: { f: '不吃辣' } },
    dinner_a2: { eventId: 'dinner', uid: 'a2', displayName: '李四', status: 'confirmed', guests: 0, guestNames: '', pollAnswers: {}, signupAnswers: {} },
    survey_a1: { eventId: 'survey', uid: 'a1', displayName: '张三', status: 'polled', guests: 0, guestNames: '', pollAnswers: { w: ['12.6'] }, signupAnswers: {} },
  }
  as('admin@x')
}

test('a dry run reports without touching anything', async () => {
  seedOldWorld()
  const res = await migrate({ confirm: 'MIGRATE_EVENTS' })
  assert.equal(res.apply, false)
  assert.equal(res.events, 2)
  assert.equal(store.events.dinner.status, 'registration')
  assert.equal(store.events.dinner.pollQuestions.length, 1)
})

test('the wrong confirmation string is refused', async () => {
  seedOldWorld()
  await assert.rejects(() => migrate({ confirm: 'nope', apply: true }), /confirm required/)
})

test('questions and statuses are renamed', async () => {
  seedOldWorld()
  await migrate({ confirm: 'MIGRATE_EVENTS', apply: true })

  const survey = store.events.survey
  assert.equal(survey.status, 'prep')
  assert.equal(survey.prepQuestions[0].id, 'w')
  assert.deepEqual(survey.questions, [])
  assert.equal(survey.pollQuestions, undefined)
  assert.equal(survey.signupQuestions, undefined)
  assert.equal(store.events.dinner.status, 'open')

  const reg = store.eventRegistrations.survey_a1
  assert.equal(reg.status, 'prepped')
  assert.deepEqual(reg.prepAnswers.w, ['12.6'])
  assert.equal(reg.pollAnswers, undefined)
})

test('家属 becomes a number question that still counts toward the cap', async () => {
  seedOldWorld()
  await migrate({ confirm: 'MIGRATE_EVENTS', apply: true })

  const qs = store.events.dinner.questions
  const guests = qs.find(q => q.id === '_guests')
  assert.equal(guests.type, 'number')
  assert.equal(guests.max, 2)
  assert.equal(guests.countsSeats, true)
  assert.ok(qs.find(q => q.id === '_guestNames'))
  assert.equal(store.events.dinner.allowGuests, undefined)

  const a1 = store.eventRegistrations.dinner_a1
  assert.equal(a1.status, 'submitted')
  assert.equal(a1.answers._guests, 2)
  assert.equal(a1.answers._guestNames, '夫人+娃')
  assert.equal(a1.answers.f, '不吃辣')
  assert.equal(a1.guests, undefined)
  assert.equal(a1.guestNames, undefined)
})

test('a form that never allowed guests gets no extra questions', async () => {
  seedOldWorld()
  await migrate({ confirm: 'MIGRATE_EVENTS', apply: true })
  assert.equal(store.events.survey.questions.length, 0)
  assert.equal(store.eventRegistrations.survey_a1.answers._guests, undefined)
})

test('re-running skips what it already converted', async () => {
  seedOldWorld()
  await migrate({ confirm: 'MIGRATE_EVENTS', apply: true })
  const again = await migrate({ confirm: 'MIGRATE_EVENTS', apply: true })
  assert.ok(again.report.every(r => r.skipped === 'already migrated'))
  assert.equal(store.events.dinner.questions.filter(q => q.id === '_guests').length, 1)
})
