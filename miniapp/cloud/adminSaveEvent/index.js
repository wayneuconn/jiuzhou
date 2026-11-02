const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const VALID_STATUS = ['draft', 'polling', 'registration', 'closed', 'cancelled']
const VALID_SCOPE = ['annual', 'member', 'all']
const SCOPE_TYPES = { annual: ['annual'], member: ['annual', 'per_session'], all: null }

function cleanQuestions(list, allowExclusive) {
  if (!Array.isArray(list)) return []
  return list.slice(0, 10).map((q, i) => ({
    id: (q.id || `q${i}_${Math.random().toString(36).slice(2, 6)}`).toString().slice(0, 20),
    title: (q.title || '').toString().trim().slice(0, 50),
    type: ['single', 'multi', 'text'].includes(q.type) ? q.type : 'single',
    options: q.type === 'text' ? [] : (Array.isArray(q.options) ? q.options.map(o => o.toString().trim().slice(0, 30)).filter(Boolean).slice(0, 12) : []),
    required: q.required !== false,
    exclusive: allowExclusive === true && q.exclusive === true && q.type === 'single',
  })).filter(q => q.title && (q.type === 'text' || q.options.length >= 2))
}

function claimId(eventId, qid, option) {
  let h = 0x811c9dc5
  const s = qid + '\u0000' + option
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return `${eventId}_${h.toString(16)}`
}

// One row per 先到先得 option, so claiming one is a conditional where-update
// that two racing players can't both win.
async function syncClaims(eventId, questions) {
  const wanted = new Map()
  for (const q of questions) {
    if (!q.exclusive) continue
    for (const option of q.options) {
      wanted.set(claimId(eventId, q.id, option), { eventId, qid: q.id, option, uid: null, displayName: '' })
    }
  }
  const snap = await db.collection('eventClaims').where({ eventId }).limit(300).get().catch(() => ({ data: [] }))
  const existing = new Set(snap.data.map(r => r._id))
  await Promise.all([
    ...[...wanted].filter(([id]) => !existing.has(id))
      .map(([id, data]) => db.collection('eventClaims').doc(id).set({ data })),
    ...snap.data.filter(r => !wanted.has(r._id) && !r.uid)
      .map(r => db.collection('eventClaims').doc(r._id).remove()),
  ])
}

// Notify in-scope members (skipping those who already joined) that a phase
// opened — reuses the 活动开始通知 template (thing4/thing2/date5).
async function notifyScope(eventId, ev, text) {
  try {
    const types = SCOPE_TYPES[ev.scope] ?? ['annual']
    const userFilter = types ? { membershipType: _.in(types) } : {}
    const [usersSnap, regsSnap] = await Promise.all([
      db.collection('users').where(userFilter).limit(200).get().catch(() => ({ data: [] })),
      db.collection('eventRegistrations').where({ eventId }).limit(300).get().catch(() => ({ data: [] })),
    ])
    const joined = new Set(regsSnap.data.map(r => r.uid))
    const d = ev.eventDate ? new Date(ev.eventDate) : new Date()
    const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
    await Promise.all(usersSnap.data
      .filter(u => u.openid && !joined.has(u._id))
      .map(u => cloud.callFunction({
        name: 'sendSubscribeMsg',
        data: {
          type: 'matchOpen',
          toOpenid: u.openid,
          data: {
            page: `/pages/event-detail/index?id=${eventId}`,
            templateData: {
              thing4: { value: text.slice(0, 20) },
              thing2: { value: (ev.title || '球队活动').slice(0, 20) },
              date5: { value: timeStr },
            },
          },
        },
      }).catch(() => {})))
  } catch (_) {}
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  // ── phase transition ────────────────────────────────────────────────────
  if (event.action === 'setStatus') {
    const { eventId, status } = event
    if (!VALID_STATUS.includes(status)) throw new Error('invalid status')
    const snap = await db.collection('events').doc(eventId).get().catch(() => ({ data: null }))
    const ev = snap.data
    if (!ev) throw new Error('event not found')
    await db.collection('events').doc(eventId).update({ data: { status } })
    if (status === 'polling' && ev.status !== 'polling') {
      await notifyScope(eventId, ev, '活动征集意见中,来投票')
    }
    if (status === 'registration' && ev.status !== 'registration') {
      await notifyScope(eventId, ev, '活动开放报名')
    }
    return { success: true }
  }

  // ── create / edit ───────────────────────────────────────────────────────
  const data = {
    title: (event.title || '').toString().trim().slice(0, 40),
    description: (event.description || '').toString().slice(0, 2000),
    location: (event.location || '').toString().trim().slice(0, 60),
    eventDate: typeof event.eventDate === 'number' ? event.eventDate : null,
    deadline: typeof event.deadline === 'number' ? event.deadline : null,
    scope: VALID_SCOPE.includes(event.scope) ? event.scope : 'annual',
    allowGuests: event.allowGuests === true,
    maxGuestsPer: Math.max(0, Math.min(10, parseInt(event.maxGuestsPer, 10) || 0)),
    maxAttendees: event.maxAttendees ? Math.max(2, parseInt(event.maxAttendees, 10) || 0) || null : null,
    pollQuestions: cleanQuestions(event.pollQuestions, false),
    signupQuestions: cleanQuestions(event.signupQuestions, true),
  }
  if (!data.title) throw new Error('请填写活动标题')

  if (event.eventId) {
    await db.collection('events').doc(event.eventId).update({ data })
    await syncClaims(event.eventId, data.signupQuestions)
    return { eventId: event.eventId }
  }
  const res = await db.collection('events').add({
    data: { ...data, status: 'draft', createdAt: db.serverDate() },
  })
  await syncClaims(res._id, data.signupQuestions)
  return { eventId: res._id }
}
