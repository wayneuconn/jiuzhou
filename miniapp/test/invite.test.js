// 邀请: one code, one person, redeeming grants 次卡 (never 年卡).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, store, calls, as, reset } = require('./harness')

const manage = load('adminManageInvite')
const redeem = load('redeemInvite')

function seedClub() {
  reset()
  store.config = { app: { season: '2025-2026' } }
  store.users = {
    admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual' },
    newbie: { openid: 'newbie@x', role: 'guest', displayName: '新人', membershipType: 'none' },
    newbie2: { openid: 'newbie2@x', role: 'guest', displayName: '新人二', membershipType: 'none' },
    member: { openid: 'member@x', role: 'member', displayName: '老队员', membershipType: 'per_session' },
  }
  as('admin@x')
}

const create = (note = '给老王') => manage({ action: 'create', note })

test('an invite needs a note saying who it is for', async () => {
  seedClub()
  await assert.rejects(() => manage({ action: 'create', note: '' }), /给谁/)
})

test('redeeming grants 次卡, and only 次卡', async () => {
  seedClub()
  const { code } = await create()

  as('newbie@x')
  const res = await redeem({ code })
  assert.equal(res.status, 'granted')
  assert.equal(store.users.newbie.membershipType, 'per_session', '年卡 still needs an application')
  assert.equal(store.invites[code].status, 'used')
  assert.equal(store.invites[code].usedBy, 'newbie')
})

test('a code works exactly once', async () => {
  seedClub()
  const { code } = await create()

  as('newbie@x')
  await redeem({ code })

  as('newbie2@x')
  const res = await redeem({ code })
  assert.equal(res.status, 'used')
  assert.equal(store.users.newbie2.membershipType, 'none', 'second person gains nothing')
})

test('the person who used it sees a friendly result on re-open, not an error', async () => {
  seedClub()
  const { code } = await create()
  as('newbie@x')
  await redeem({ code })

  const again = await redeem({ code })
  assert.equal(again.status, 'alreadyMine')
})

test('codes are case-insensitive on the way in', async () => {
  seedClub()
  const { code } = await create()
  as('newbie@x')
  const res = await redeem({ code: code.toLowerCase() })
  assert.equal(res.status, 'granted')
})

test('an existing member does not burn the code', async () => {
  seedClub()
  const { code } = await create()

  as('member@x')
  const res = await redeem({ code })
  assert.equal(res.status, 'alreadyMember')
  assert.equal(store.invites[code].status, 'open', 'still available for its real recipient')
})

test('revoked and expired codes are refused', async () => {
  seedClub()
  const a = await create('撤回的')
  await manage({ action: 'revoke', code: a.code })
  as('newbie@x')
  assert.equal((await redeem({ code: a.code })).status, 'revoked')

  as('admin@x')
  const b = await create('过期的')
  store.invites[b.code].expiresAt = Date.now() - 1000
  as('newbie@x')
  assert.equal((await redeem({ code: b.code })).status, 'expired')
  assert.equal(store.users.newbie.membershipType, 'none')
})

test('an unknown code is reported, not thrown', async () => {
  seedClub()
  as('newbie@x')
  assert.equal((await redeem({ code: 'ZZZZZZZZ' })).status, 'notFound')
})

test('someone without a profile keeps the code for later', async () => {
  seedClub()
  const { code } = await create()

  as('nobody@x') // logged in, no user doc yet
  const res = await redeem({ code })
  assert.equal(res.status, 'needProfile')
  assert.equal(store.invites[code].status, 'open', 'not spent')
})

test('a used code cannot be revoked after the fact', async () => {
  seedClub()
  const { code } = await create()
  as('newbie@x')
  await redeem({ code })
  as('admin@x')
  await assert.rejects(() => manage({ action: 'revoke', code }), /已被使用/)
})

test('the issuing admin is told when it lands', async () => {
  seedClub()
  const { code } = await create('给老王')
  calls.length = 0
  as('newbie@x')
  await redeem({ code })

  const sent = calls.filter(c => c.name === 'sendSubscribeMsg')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].data.toOpenid, 'admin@x')
})

test('listing marks expiry at read time, without a cron', async () => {
  seedClub()
  const { code } = await create()
  store.invites[code].expiresAt = Date.now() - 1000

  const { invites } = await manage({ action: 'list' })
  const row = invites.find(i => i.code === code)
  assert.equal(row.status, 'open', 'stored state untouched')
  assert.equal(row.expired, true, 'but reported as expired')
})

test('codes avoid look-alike characters', async () => {
  seedClub()
  for (let i = 0; i < 20; i++) {
    const { code } = await create('批量检查')
    assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/, code)
  }
})

test('only admins can create, list or revoke', async () => {
  seedClub()
  as('member@x')
  await assert.rejects(() => manage({ action: 'create', note: 'x' }), /admins only/)
  await assert.rejects(() => manage({ action: 'list' }), /admins only/)
  await assert.rejects(() => manage({ action: 'revoke', code: 'ABCDEFGH' }), /admins only/)
})
