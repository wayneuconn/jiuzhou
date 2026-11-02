// Excel export of an event's answers. The workbook is unzipped back out so the
// archive itself is checked, not just the rows that went in.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const { load, store, uploads, as, reset } = require('./harness')

const exportResults = load('exportEventResults')

function unzip(buf) {
  const files = {}
  let i = 0
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8)
    const compressed = buf.readUInt32LE(i + 18)
    const nameLen = buf.readUInt16LE(i + 26)
    const extraLen = buf.readUInt16LE(i + 28)
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8')
    const start = i + 30 + nameLen + extraLen
    const raw = buf.slice(start, start + compressed)
    files[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8')
    i = start + compressed
  }
  return files
}

const Q = [{ id: 'kit', title: '球衣号码', type: 'single', options: ['7', '10'], required: true, exclusive: true }]

function seedEvent() {
  reset()
  store.users = {
    admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual' },
    a1: { openid: 'a1@x', role: 'member', displayName: '张三', membershipType: 'annual' },
    a2: { openid: 'a2@x', role: 'member', displayName: '李四 & 友', membershipType: 'annual' },
    a3: { openid: 'a3@x', role: 'member', displayName: '王五', membershipType: 'annual' },
  }
  store.events = {
    ev1: {
      title: '订队服', scope: 'all', status: 'registration', location: '球场',
      eventDate: Date.parse('2026-12-05T18:00:00Z'), deadline: null,
      pollQuestions: [], signupQuestions: Q,
    },
  }
  store.eventRegistrations = {
    ev1_a1: { eventId: 'ev1', uid: 'a1', displayName: '张三', status: 'confirmed', guests: 1, guestNames: '夫人', pollAnswers: {}, signupAnswers: { kit: '10' }, registeredAt: new Date('2026-11-02T15:00:00Z') },
    ev1_a2: { eventId: 'ev1', uid: 'a2', displayName: '李四 & 友', status: 'confirmed', guests: 0, guestNames: '', pollAnswers: {}, signupAnswers: { kit: '7' }, registeredAt: new Date('2026-11-02T16:00:00Z') },
  }
  as('admin@x')
}

test('non-admins cannot export', async () => {
  seedEvent()
  as('a1@x')
  await assert.rejects(() => exportResults({ eventId: 'ev1' }), /admins only/)
})

test('the workbook is a readable zip with the expected sheets', async () => {
  seedEvent()
  const res = await exportResults({ eventId: 'ev1' })
  assert.match(res.fileID, /^cloud:\/\/stub\/exports\/events\/ev1_/)
  assert.match(res.fileName, /^订队服_.*\.xlsx$/)

  const files = unzip(uploads[0].fileContent)
  assert.ok(files['[Content_Types].xml'])
  assert.ok(files['xl/workbook.xml'])
  const names = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(names, ['概况', '报名名单', '统计', '未响应'])
})

test('answers, guests and the holder of each number land in the rows', async () => {
  seedEvent()
  await exportResults({ eventId: 'ev1' })
  const files = unzip(uploads[0].fileContent)

  const roster = files['xl/worksheets/sheet2.xml']
  assert.ok(roster.includes('球衣号码'))
  assert.ok(roster.includes('张三'))
  assert.ok(roster.includes('夫人'))
  assert.ok(roster.includes('李四 &amp; 友'))
  assert.ok(roster.includes('2026-11-02 11:00'))

  const tally = files['xl/worksheets/sheet3.xml']
  assert.ok(tally.includes('先到先得') === false)
  assert.ok(tally.includes('报名'))
  assert.ok(tally.includes('王五') === false)
})

test('people in scope who never answered get their own sheet', async () => {
  seedEvent()
  await exportResults({ eventId: 'ev1' })
  const quiet = unzip(uploads[0].fileContent)['xl/worksheets/sheet4.xml']
  assert.ok(quiet.includes('王五'))
  assert.ok(quiet.includes('张三') === false)
})

test('a poll sheet appears only when the event has poll questions', async () => {
  seedEvent()
  store.events.ev1.pollQuestions = [{ id: 'day', title: '哪天', type: 'single', options: ['周六', '周日'], required: true }]
  store.eventRegistrations.ev1_a3 = { eventId: 'ev1', uid: 'a3', displayName: '王五', status: 'polled', guests: 0, guestNames: '', pollAnswers: { day: '周日' }, signupAnswers: {}, registeredAt: new Date('2026-11-02T14:00:00Z') }
  await exportResults({ eventId: 'ev1' })
  const files = unzip(uploads[0].fileContent)
  const names = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(names, ['概况', '报名名单', '投票', '统计', '未响应'])
  assert.ok(files['xl/worksheets/sheet3.xml'].includes('周日'))
})
