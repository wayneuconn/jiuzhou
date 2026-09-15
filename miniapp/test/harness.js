// Loads a cloud function with wx-server-sdk swapped for the in-memory stub.
//
// The functions are plain CommonJS with a top-level `require('wx-server-sdk')`,
// and nothing is installed under cloud/*/node_modules locally, so resolution is
// intercepted instead. node --test gives each test file its own process, so the
// hook can't leak between files.
const Module = require('module')
const path = require('path')
const stub = require('./stub-sdk')

const nativeLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'wx-server-sdk') return stub
  return nativeLoad.call(this, request, ...rest)
}

const CLOUD = path.join(__dirname, '..', 'cloud')

// Named cloud function → its main(), sharing one stub database.
function load(name) {
  return require(path.join(CLOUD, name, 'index.js')).main
}

const { store, calls, as, reset } = stub.__stub

// A club with one match in the books and one open for signups. Kickoff is a
// week out so the match-day 12:00 cutoff never trips.
function seed(overrides = {}) {
  reset()
  store.config = {
    app: { absentGkHalves: 2, lateThreshold: 3, waitlistConfirmMinutes: 30, ...overrides.config },
  }
  store.users = {
    admin: { openid: 'admin@x', role: 'admin', displayName: '管理员', membershipType: 'annual' },
    p1: { openid: 'p1@x', role: 'member', displayName: '张三', membershipType: 'annual', attendanceCount: 5 },
    p2: { openid: 'p2@x', role: 'member', displayName: '李四', membershipType: 'annual', attendanceCount: 5 },
    p3: { openid: 'p3@x', role: 'member', displayName: '王五', membershipType: 'annual', attendanceCount: 5 },
    ...overrides.users,
  }
  const kickoff = Date.now() + 7 * 864e5
  store.matches = {
    played: { status: 'completed', date: kickoff, maxPlayers: 22, location: '球场' },
    open: { status: 'registration_r2', date: kickoff, maxPlayers: 22, location: '球场' },
    ...overrides.matches,
  }
  store.registrations = { ...overrides.registrations }
  as('admin@x')
  return store
}

// A registration row as it looks once a GK duty has been claimed
function gkReg(matchId, uid, displayName, { halves = 1, reason = 'absent', status = 'confirmed' } = {}) {
  return {
    matchId, uid, displayName, status, tags: [],
    gkPenalty: true, gkHalves: halves, gkReason: reason,
  }
}

module.exports = { load, store, calls, as, reset, seed, gkReg }
