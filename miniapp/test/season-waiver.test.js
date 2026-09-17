// 赛季确认书: admin authors it, players confirm once per season, and an
// unconfirmed player can't take a spot.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, store, as, reset } = require('./harness')

const adminWaiver = load('adminManageWaiver')
const sign = load('signSeasonWaiver')
const register = load('registerForMatch')

const SEASON = '2025-2026'
const BODY = '参与本队活动存在受伤风险，参与者自愿承担相应风险。'

function seedClub() {
  reset()
  store.config = { app: { season: SEASON } }
  store.users = {
    admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual' },
    p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual' },
    p2: { openid: 'p2@x', role: 'member', displayName: '李四', membershipType: 'per_session' },
  }
  store.matches = {
    open: { status: 'registration_r2', date: Date.now() + 7 * 864e5, maxPlayers: 22, location: '球场' },
  }
  store.registrations = {}
  as('admin@x')
}

const publish = (extra = {}) =>
  adminWaiver({ action: 'save', title: '参与须知', body: BODY, effectiveDate: 'Oct 25, 2026', ...extra })

test('a waiver has to have a title and body', async () => {
  seedClub()
  await assert.rejects(() => adminWaiver({ action: 'save', title: '', body: BODY }), /标题/)
  await assert.rejects(() => adminWaiver({ action: 'save', title: '参与须知', body: '' }), /正文/)
})

test('publishing starts at version 1 and gates registration by default', async () => {
  seedClub()
  const res = await publish()
  assert.equal(res.version, 1)
  assert.equal(store.waivers[SEASON].required, true)
})

test('an unconfirmed player cannot register', async () => {
  seedClub()
  await publish()
  as('p1@x')
  await assert.rejects(() => register({ matchId: 'open' }), /参与须知/)
  assert.equal(store.registrations.open_p1, undefined, 'no spot taken')
})

test('confirming clears the gate', async () => {
  seedClub()
  await publish()

  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })
  const sig = store.waiverSignatures[SEASON + '_p1']
  assert.equal(sig.realName, '张三丰')
  assert.equal(sig.version, 1)
  assert.ok(sig.bodyHash, 'the exact text agreed to is fingerprinted')

  const res = await register({ matchId: 'open' })
  assert.equal(res.status, 'confirmed')
})

test('confirming needs a real name and the tick', async () => {
  seedClub()
  await publish()
  as('p1@x')
  await assert.rejects(() => sign({ agreed: true }), /真实姓名/)
  await assert.rejects(() => sign({ realName: '张三丰' }), /勾选/)
  await assert.rejects(() => sign({ realName: 'x'.repeat(30), agreed: true }), /真实姓名/)
})

test('a typo fix keeps everyone confirmed', async () => {
  seedClub()
  await publish()
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })

  as('admin@x')
  await publish({ body: BODY + '（补充说明）' })
  assert.equal(store.waivers[SEASON].version, 1, 'version unchanged')

  as('p1@x')
  const res = await register({ matchId: 'open' })
  assert.equal(res.status, 'confirmed', 'still clear')
})

test('asking for a re-confirm bumps the version and re-gates everyone', async () => {
  seedClub()
  await publish()
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })

  as('admin@x')
  const res = await publish({ body: '全新的条款内容', requireResign: true })
  assert.equal(res.version, 2)

  as('p1@x')
  await assert.rejects(() => register({ matchId: 'open' }), /参与须知/)

  await sign({ realName: '张三丰', agreed: true })
  assert.equal(store.waiverSignatures[SEASON + '_p1'].version, 2)
  assert.equal((await register({ matchId: 'open' })).status, 'confirmed')
})

test('turning the gate off lets people register without confirming', async () => {
  seedClub()
  await publish({ required: false })
  as('p1@x')
  assert.equal((await register({ matchId: 'open' })).status, 'confirmed')
})

test('no waiver at all means no gate', async () => {
  seedClub()
  as('p1@x')
  assert.equal((await register({ matchId: 'open' })).status, 'confirmed')
})

test('the board separates confirmed from outstanding', async () => {
  seedClub()
  await publish()
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })

  as('admin@x')
  const board = await adminWaiver({ action: 'board' })
  assert.equal(board.signatures.length, 1)
  assert.equal(board.signatures[0].realName, '张三丰')
  assert.deepEqual(
    board.pending.map(p => p.displayName).sort(),
    ['李四', '管理员'],
    'everyone who still owes a confirmation, admins included',
  )
})

test('a stale signature counts as outstanding on the board', async () => {
  seedClub()
  await publish()
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })
  as('admin@x')
  await publish({ body: '新条款', requireResign: true })

  const board = await adminWaiver({ action: 'board' })
  assert.ok(board.pending.some(p => p.displayName === '张三'), 'back in the pending list')
})

test('re-confirming overwrites rather than piling up rows', async () => {
  seedClub()
  await publish()
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })
  await sign({ realName: '张三丰', agreed: true })
  assert.equal(Object.keys(store.waiverSignatures).length, 1)
})

test('only admins can publish; anyone signed in can confirm', async () => {
  seedClub()
  as('p1@x')
  await assert.rejects(() => publish(), /admins only/)
  await assert.rejects(() => adminWaiver({ action: 'board' }), /admins only/)
})

test('confirming needs a profile and an existing waiver', async () => {
  seedClub()
  as('nobody@x')
  await assert.rejects(() => sign({ realName: '无名', agreed: true }), /完善个人资料/)

  as('p1@x')
  await assert.rejects(() => sign({ realName: '张三丰', agreed: true }), /暂无需要确认/)
})

test('the profile carries a copy for the roster view', async () => {
  seedClub()
  await publish()
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })
  assert.equal(store.users.p1.waiverSeason, SEASON)
  assert.equal(store.users.p1.waiverVersion, 1)
})

// Clause 10 of the waiver: "Electronic registration logs (including timestamps
// and IP addresses) will be retained as evidence of acceptance."
test('the archive keeps the evidence clause 10 names', async () => {
  seedClub()
  await publish()
  as('p1@x', '198.51.100.22')
  await sign({ realName: '张三丰', agreed: true })

  const sig = store.waiverSignatures[SEASON + '_p1']
  assert.equal(sig.clientIp, '198.51.100.22', 'IP address')
  assert.ok(sig.signedAt, 'server-side timestamp')
  assert.equal(sig.effectiveDate, 'Oct 25, 2026', 'which edition of the document')
  assert.equal(sig.realName, '张三丰')
})

test('the IP comes from the platform, not from the caller', async () => {
  seedClub()
  await publish()
  as('p1@x', '198.51.100.22')
  // A client trying to dictate its own evidence gets ignored
  await sign({ realName: '张三丰', agreed: true, clientIp: '10.0.0.1' })
  assert.equal(store.waiverSignatures[SEASON + '_p1'].clientIp, '198.51.100.22')
})

test('the body hash pins what was actually on screen', async () => {
  seedClub()
  await publish()
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })
  const before = store.waiverSignatures[SEASON + '_p1'].bodyHash

  // A silent edit (no re-sign required) must not rewrite history
  as('admin@x')
  await publish({ body: BODY + ' 追加了一句。' })
  assert.equal(store.waiverSignatures[SEASON + '_p1'].bodyHash, before, 'archive untouched')

  as('p2@x')
  await sign({ realName: '李四光', agreed: true })
  assert.notEqual(
    store.waiverSignatures[SEASON + '_p2'].bodyHash, before,
    'someone signing after the edit is recorded against the new text',
  )
})

// The signature pad is an extra on top of the checkbox, switchable by config
// so that review feedback never requires a code change.
test('handwriting off: a drawn signature is not demanded', async () => {
  seedClub()
  await publish()
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })
  assert.equal(store.waiverSignatures[SEASON + '_p1'].signatureFileId, '')
})

test('handwriting on: confirming without ink is refused', async () => {
  seedClub()
  await publish({ handwriting: true })
  as('p1@x')
  await assert.rejects(() => sign({ realName: '张三丰', agreed: true }), /签写姓名/)
  // Nothing was written at all, so the collection may not even exist yet
  assert.equal(store.waiverSignatures?.[SEASON + '_p1'], undefined)
})

test('handwriting on: the drawn image is archived with the rest', async () => {
  seedClub()
  await publish({ handwriting: true })
  as('p1@x', '198.51.100.9')
  await sign({
    realName: '张三丰',
    agreed: true,
    signatureFileId: 'cloud://env.abc/waiver-signatures/2025-2026_p1_1.png',
  })
  const sig = store.waiverSignatures[SEASON + '_p1']
  assert.equal(sig.signatureFileId, 'cloud://env.abc/waiver-signatures/2025-2026_p1_1.png')
  assert.equal(sig.clientIp, '198.51.100.9')
  assert.equal(sig.realName, '张三丰')
})

test('only a cloud:// id is accepted as a signature', async () => {
  seedClub()
  await publish({ handwriting: true })
  as('p1@x')
  await assert.rejects(
    () => sign({ realName: '张三丰', agreed: true, signatureFileId: 'https://evil.example/x.png' }),
    /签名图片无效/,
  )
  await assert.rejects(
    () => sign({ realName: '张三丰', agreed: true, signatureFileId: 'javascript:alert(1)' }),
    /签名图片无效/,
  )
})

test('the requirement flips without touching the text or the archive', async () => {
  seedClub()
  await publish({ handwriting: true })
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true, signatureFileId: 'cloud://env.abc/a.png' })

  as('admin@x')
  await adminWaiver({ action: 'setHandwriting', handwriting: false })
  assert.equal(store.waivers[SEASON].handwriting, false)
  assert.equal(store.waivers[SEASON].version, 1, 'no re-confirmation forced')
  assert.equal(store.waiverSignatures[SEASON + '_p1'].signatureFileId, 'cloud://env.abc/a.png', 'archive kept')

  // And the next person can confirm without drawing
  as('p2@x')
  await sign({ realName: '李四光', agreed: true })
  assert.equal(store.waiverSignatures[SEASON + '_p2'].signatureFileId, '')
})

// The readable transcription and the original PDF travel together: `body` is
// what people read on a phone, `pdfFileId` is what the archive points at.
test('the original in force is recorded on each confirmation', async () => {
  seedClub()
  await publish({ pdfFileId: 'cloud://env.abc/waivers/2025-2026.pdf' })
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })
  assert.equal(store.waiverSignatures[SEASON + '_p1'].pdfFileId, 'cloud://env.abc/waivers/2025-2026.pdf')
})

test('swapping the original does not rewrite past confirmations', async () => {
  seedClub()
  await publish({ pdfFileId: 'cloud://env.abc/v1.pdf' })
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })

  as('admin@x')
  await publish({ pdfFileId: 'cloud://env.abc/v2.pdf' })
  assert.equal(
    store.waiverSignatures[SEASON + '_p1'].pdfFileId, 'cloud://env.abc/v1.pdf',
    'still points at the document that was actually shown',
  )
})

test('an external link is refused as the original', async () => {
  seedClub()
  await assert.rejects(
    () => publish({ pdfFileId: 'https://evil.example/fake.pdf' }),
    /原件地址无效/,
  )
})

test('the original is optional', async () => {
  seedClub()
  await publish()
  as('p1@x')
  await sign({ realName: '张三丰', agreed: true })
  assert.equal(store.waiverSignatures[SEASON + '_p1'].pdfFileId, '')
})
