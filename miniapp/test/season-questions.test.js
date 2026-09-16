// Admin-authored questions on 赛季年卡登记.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, store, as, reset } = require('./harness')

const adminSeason = load('adminSeasonAction')
const respond = load('respondSeasonRenewal')

const NEXT = '2026-2027'

const Q = [
  { id: 'games', title: '这赛季大概能来几场？', type: 'single', options: ['大部分都来', '一半左右', '看情况'], required: true },
  { id: 'pos', title: '主踢什么位置？', type: 'multi', options: ['门将', '后卫', '中场', '前锋'], required: false },
  { id: 'say', title: '有什么想说的？', type: 'text', options: [], required: false },
]

function seedClub() {
  reset()
  store.config = { app: { season: '2025-2026' } }
  store.users = {
    admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual', annualSeason: '2025-2026' },
    a1: { openid: 'a1@x', role: 'member', displayName: '张三', membershipType: 'annual', annualSeason: '2025-2026' },
  }
  as('admin@x')
}

const openWith = (questions) =>
  adminSeason({ action: 'openDrive', season: NEXT, deadline: null, note: '', questions })

test('questions are stored with the drive', async () => {
  seedClub()
  await openWith(Q)
  assert.equal(store.seasonDrives[NEXT].questions.length, 3)
  assert.equal(store.seasonDrives[NEXT].questions[0].title, '这赛季大概能来几场？')
})

test('answers are saved alongside the response', async () => {
  seedClub()
  await openWith(Q)

  as('a1@x')
  await respond({
    response: 'continue',
    birthday: '07-04',
    answers: { games: '一半左右', pos: ['中场', '前锋'], say: '今年少出差' },
  })

  const r = store.seasonRenewals[NEXT + '_a1']
  assert.equal(r.answers.games, '一半左右')
  assert.deepEqual(r.answers.pos, ['中场', '前锋'])
  assert.equal(r.answers.say, '今年少出差')
})

test('a required question blocks submission, named in the error', async () => {
  seedClub()
  await openWith(Q)
  as('a1@x')
  await assert.rejects(
    () => respond({ response: 'continue', birthday: '07-04', answers: { pos: ['中场'] } }),
    /这赛季大概能来几场/,
  )
  assert.equal(store.seasonRenewals[NEXT + '_a1'], undefined, 'nothing written')
})

test('optional questions can be skipped', async () => {
  seedClub()
  await openWith(Q)
  as('a1@x')
  await respond({ response: 'continue', birthday: '07-04', answers: { games: '看情况' } })
  const r = store.seasonRenewals[NEXT + '_a1']
  assert.equal(r.answers.games, '看情况')
  assert.equal(r.answers.pos, undefined)
})

test('options outside the list are dropped, not stored', async () => {
  seedClub()
  await openWith(Q)
  as('a1@x')
  await respond({
    response: 'continue',
    birthday: '07-04',
    answers: { games: '大部分都来', pos: ['中场', '教练席'] },
  })
  assert.deepEqual(store.seasonRenewals[NEXT + '_a1'].answers.pos, ['中场'], 'bogus option removed')
})

test('a bogus answer to a required question is treated as missing', async () => {
  seedClub()
  await openWith(Q)
  as('a1@x')
  await assert.rejects(
    () => respond({ response: 'continue', birthday: '07-04', answers: { games: '天天来' } }),
    /这赛季大概能来几场/,
  )
})

test('declining skips the questions entirely', async () => {
  seedClub()
  await openWith(Q)
  as('a1@x')
  await respond({ response: 'decline' })
  assert.deepEqual(store.seasonRenewals[NEXT + '_a1'].answers, {})
})

test('malformed questions are filtered out when saving', async () => {
  seedClub()
  await openWith([
    { id: 'ok', title: '有效', type: 'single', options: ['A', 'B'], required: true },
    { id: 'noTitle', title: '   ', type: 'single', options: ['A', 'B'], required: true },
    { id: 'oneOpt', title: '只有一个选项', type: 'single', options: ['A'], required: true },
    { id: 'txt', title: '填空不需要选项', type: 'text', options: [], required: false },
  ])
  const saved = store.seasonDrives[NEXT].questions
  assert.deepEqual(saved.map(q => q.id), ['ok', 'txt'], 'blank title and single-option choices dropped')
})

test('at most 10 questions, and long text is trimmed', async () => {
  seedClub()
  const many = Array.from({ length: 15 }, (_, i) => ({
    id: `q${i}`, title: 'x'.repeat(80), type: 'text', options: [], required: false,
  }))
  await openWith(many)
  const saved = store.seasonDrives[NEXT].questions
  assert.equal(saved.length, 10)
  assert.equal(saved[0].title.length, 50)
})

test('a text answer is capped at 200 chars', async () => {
  seedClub()
  await openWith([{ id: 'say', title: '说点什么', type: 'text', options: [], required: false }])
  as('a1@x')
  await respond({ response: 'continue', birthday: '01-01', answers: { say: 'y'.repeat(500) } })
  assert.equal(store.seasonRenewals[NEXT + '_a1'].answers.say.length, 200)
})

test('questions can be retuned while the drive is open', async () => {
  seedClub()
  await openWith(Q)
  await adminSeason({
    action: 'editQuestions',
    season: NEXT,
    questions: [{ id: 'new', title: '换个问题', type: 'single', options: ['是', '否'], required: true }],
  })
  const saved = store.seasonDrives[NEXT].questions
  assert.deepEqual(saved.map(q => q.id), ['new'])
})

test('retuning keeps answers already given', async () => {
  seedClub()
  await openWith(Q)
  as('a1@x')
  await respond({ response: 'continue', birthday: '01-01', answers: { games: '看情况' } })

  as('admin@x')
  await adminSeason({ action: 'editQuestions', season: NEXT, questions: [] })
  assert.equal(store.seasonRenewals[NEXT + '_a1'].answers.games, '看情况', 'past answer untouched')
})

test('questions cannot be changed after rollover', async () => {
  seedClub()
  await openWith(Q)
  await adminSeason({ action: 'rollover', season: NEXT, confirm: true })
  await assert.rejects(
    () => adminSeason({ action: 'editQuestions', season: NEXT, questions: [] }),
    /已换季/,
  )
})

test('only admins can author questions', async () => {
  seedClub()
  await openWith(Q)
  as('a1@x')
  await assert.rejects(
    () => adminSeason({ action: 'editQuestions', season: NEXT, questions: [] }),
    /admins only/,
  )
})

test('a drive with no questions still works', async () => {
  seedClub()
  await openWith([])
  as('a1@x')
  await respond({ response: 'continue', birthday: '01-01' })
  assert.deepEqual(store.seasonRenewals[NEXT + '_a1'].answers, {})
})
