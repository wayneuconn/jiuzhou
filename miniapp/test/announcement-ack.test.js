// 需确认弹窗公告：确认前每次进比赛页都弹，确认后不再弹，管理员看得到谁确认了。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, store, as, seed } = require('./harness')

const getMatchDetail = load('getMatchDetail')
const ack = load('ackAnnouncement')
const adminList = load('adminGetAnnouncements')
const adminDelete = load('adminDeleteAnnouncement')

function seedAnns() {
  seed()
  store.announcements = {
    rules: { title: '新规', content: '看这里 https://x.co/a', popup: true, requireAck: true, popupUntil: null, createdAt: 2 },
    plain: { title: '普通', content: '随便看看', popup: true, popupUntil: null, createdAt: 1 },
  }
  store.announcementAcks = {}
}

const popupFor = async openid => { as(openid); return (await getMatchDetail({ matchId: 'open' })).popupAnn }

test('需确认 popup shows until confirmed, then the next popup takes its place', async () => {
  seedAnns()
  let p = await popupFor('p1@x')
  assert.equal(p.id, 'rules')
  assert.equal(p.requireAck, true)

  p = await popupFor('p1@x')
  assert.equal(p.id, 'rules', 'declining leaves it pending')

  as('p1@x')
  await ack({ id: 'rules' })
  await ack({ id: 'rules' })
  assert.equal(Object.keys(store.announcementAcks).length, 1, 'confirming twice is a no-op')

  p = await popupFor('p1@x')
  assert.equal(p.id, 'plain')
  assert.equal(p.requireAck, false)

  p = await popupFor('p2@x')
  assert.equal(p.id, 'rules', 'other players still have to confirm')
})

test('visitors see it without being asked to confirm', async () => {
  seedAnns()
  const p = await popupFor('stranger@x')
  assert.equal(p.id, 'rules')
  assert.equal(p.requireAck, false)
})

test('admins see who confirmed; deleting clears the acks', async () => {
  seedAnns()
  as('p1@x'); await ack({ id: 'rules' })
  as('p2@x'); await ack({ id: 'rules' })
  as('admin@x')
  const { announcements } = await adminList({})
  assert.deepEqual(announcements.find(a => a.id === 'rules').ackNames.sort(), ['张三', '李四'].sort())
  await adminDelete({ id: 'rules' })
  assert.equal(Object.keys(store.announcementAcks).length, 0)
})
