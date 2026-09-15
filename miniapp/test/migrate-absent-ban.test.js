// One-off migration: 旷赛 bans → GK-half debt.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, store, as, reset } = require('./harness')

const migrate = load('migrateAbsentBan')

function seedBans() {
  reset()
  store.config = { app: { absentGkHalves: 2 } }
  store.users = {
    fresh:  { displayName: '刚被禁', absentCount: 1, banGamesLeft: 4 },
    half:   { displayName: '服了一半', absentCount: 1, banGamesLeft: 2 },
    nearly: { displayName: '快服完', absentCount: 2, banGamesLeft: 1 },
    manual: { displayName: '手动禁赛', absentCount: 0, banGamesLeft: 3 },
    clean:  { displayName: '清白', absentCount: 0, banGamesLeft: 0 },
  }
  as(null) // invoked from the CLI, not the mini program
}

test('refuses to run without the confirm token', async () => {
  seedBans()
  await assert.rejects(() => migrate({}), /confirm token required/)
})

test('refuses non-admin callers from the mini program', async () => {
  seedBans()
  store.users.joe = { openid: 'joe@x', role: 'member', displayName: '张三' }
  as('joe@x')
  await assert.rejects(() => migrate({ confirm: 'MIGRATE_ABSENT_BAN' }), /admins only/)
})

test('dry run reports without writing', async () => {
  seedBans()
  const res = await migrate({ confirm: 'MIGRATE_ABSENT_BAN' })

  assert.equal(res.mode, 'dry-run (nothing written)')
  assert.equal(res.convertedCount, 3, 'three bans trace back to an absence')
  assert.equal(store.users.fresh.banGamesLeft, 4, 'ban untouched')
  assert.equal(store.users.fresh.gkHalvesOwed, undefined, 'no debt written')
})

test('applies pro-rated to the unserved part of each ban', async () => {
  seedBans()
  await migrate({ confirm: 'MIGRATE_ABSENT_BAN', apply: true })

  assert.deepEqual(
    [store.users.fresh.banGamesLeft, store.users.fresh.gkHalvesOwed], [0, 2],
    '4 games left → a whole match in goal',
  )
  assert.deepEqual(
    [store.users.half.banGamesLeft, store.users.half.gkHalvesOwed], [0, 1],
    '2 games left → one half',
  )
  assert.deepEqual(
    [store.users.nearly.banGamesLeft, store.users.nearly.gkHalvesOwed], [0, 1],
    '1 game left → still a half; a ban is never fully forgiven',
  )
})

test('leaves a ban alone when no absence is on record', async () => {
  seedBans()
  await migrate({ confirm: 'MIGRATE_ABSENT_BAN', apply: true })
  assert.equal(store.users.manual.banGamesLeft, 3, 'manual sanction survives')
})

test('backfills the new counters so admin lists render zeros', async () => {
  seedBans()
  await migrate({ confirm: 'MIGRATE_ABSENT_BAN', apply: true })
  assert.deepEqual([store.users.clean.gkHalvesOwed, store.users.clean.absentCount], [0, 0])
  assert.equal(store.users.manual.gkHalvesOwed, 0)
})

test('re-running never double-credits', async () => {
  seedBans()
  await migrate({ confirm: 'MIGRATE_ABSENT_BAN', apply: true })
  // A stray ban reappears — an admin re-banned them by hand, say
  store.users.fresh.banGamesLeft = 4

  const res = await migrate({ confirm: 'MIGRATE_ABSENT_BAN', apply: true })
  assert.equal(res.convertedCount, 0)
  assert.equal(res.skipped.length, 1, 'and says why it skipped')
  assert.equal(store.users.fresh.gkHalvesOwed, 2, 'debt not stacked a second time')
})

test('honours a non-default absentGkHalves', async () => {
  seedBans()
  store.config.app.absentGkHalves = 4
  await migrate({ confirm: 'MIGRATE_ABSENT_BAN', apply: true })
  assert.equal(store.users.fresh.gkHalvesOwed, 4, 'full ban → the configured penalty')
  assert.equal(store.users.half.gkHalvesOwed, 2, 'half-served → half of it')
})
