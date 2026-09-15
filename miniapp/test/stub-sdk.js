// In-memory stand-in for wx-server-sdk, so cloud functions can be exercised
// offline with real assertions — no tcb login, no network, no live database.
// Covers the slice of the CloudBase API the functions actually use; anything
// beyond that should be added here rather than worked around in a test.
const store = {}
let ctx = { OPENID: null }
const calls = []

const OPS = {
  gt: v => ({ __op: 'gt', v }),
  gte: v => ({ __op: 'gte', v }),
  lt: v => ({ __op: 'lt', v }),
  lte: v => ({ __op: 'lte', v }),
  neq: v => ({ __op: 'neq', v }),
  in: v => ({ __op: 'in', v }),
  exists: v => ({ __op: 'exists', v }),
  inc: v => ({ __op: 'inc', v }),
  remove: () => ({ __op: 'remove' }),
}

function satisfies(doc, cond) {
  return Object.entries(cond).every(([field, want]) => {
    const got = doc[field]
    if (want && want.__op) {
      switch (want.__op) {
        case 'gt': return (got ?? 0) > want.v
        case 'gte': return (got ?? 0) >= want.v
        case 'lt': return (got ?? 0) < want.v
        case 'lte': return (got ?? 0) <= want.v
        case 'neq': return got !== want.v
        case 'in': return want.v.includes(got)
        case 'exists': return want.v ? got !== undefined : got === undefined
        default: throw new Error('stub: unsupported query op ' + want.__op)
      }
    }
    return got === want
  })
}

function applyUpdate(doc, data) {
  for (const [field, v] of Object.entries(data)) {
    if (v && v.__op === 'inc') doc[field] = (doc[field] ?? 0) + v.v
    else if (v && v.__op === 'remove') delete doc[field]
    else doc[field] = v
  }
}

function collection(name) {
  store[name] = store[name] || {}
  const col = store[name]

  const build = (cond, order, cap) => {
    const rows = () => {
      let out = Object.entries(col)
        .filter(([, d]) => satisfies(d, cond))
        .map(([_id, d]) => ({ _id, ...d }))
      if (order) {
        const { field, dir } = order
        out.sort((a, b) => {
          const x = a[field] ?? 0
          const y = b[field] ?? 0
          const cmp = x > y ? 1 : x < y ? -1 : 0
          return dir === 'desc' ? -cmp : cmp
        })
      }
      return cap === undefined ? out : out.slice(0, cap)
    }
    return {
      where: c => build({ ...cond, ...c }, order, cap),
      orderBy: (field, dir) => build(cond, { field, dir }, cap),
      limit: n => build(cond, order, n),
      get: async () => ({ data: rows() }),
      count: async () => ({ total: rows().length }),
      update: async ({ data }) => {
        const hit = rows()
        hit.forEach(r => applyUpdate(col[r._id], data))
        return { stats: { updated: hit.length } }
      },
      remove: async () => {
        const hit = rows()
        hit.forEach(r => { delete col[r._id] })
        return { stats: { removed: hit.length } }
      },
    }
  }

  return {
    ...build({}, null, undefined),
    doc: id => ({
      get: async () => {
        if (!col[id]) throw new Error('document does not exist')
        return { data: { _id: id, ...col[id] } }
      },
      set: async ({ data }) => { col[id] = { ...data }; return {} },
      update: async ({ data }) => {
        if (!col[id]) throw new Error('document does not exist')
        applyUpdate(col[id], data)
        return {}
      },
      remove: async () => { delete col[id]; return {} },
    }),
    add: async ({ data }) => {
      const id = 'gen_' + Object.keys(col).length + '_' + Math.random().toString(36).slice(2, 8)
      col[id] = { ...data }
      return { _id: id }
    },
  }
}

module.exports = {
  DYNAMIC_CURRENT_ENV: 'stub-env',
  init: () => {},
  getWXContext: () => ctx,
  // Cross-function calls (notifications) are recorded, never executed
  callFunction: async (args) => { calls.push(args); return { result: {} } },
  database: () => ({
    collection,
    command: OPS,
    serverDate: () => new Date('2026-09-15T12:00:00Z'),
  }),
  __stub: {
    store,
    calls,
    as: openid => { ctx = { OPENID: openid } },
    reset: () => {
      for (const k of Object.keys(store)) delete store[k]
      calls.length = 0
      ctx = { OPENID: null }
    },
  },
}
