const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const SCOPE_TYPES = { annual: ['annual'], member: ['annual', 'per_session'], all: null }

function inScope(user, scope) {
  if (user.role === 'admin') return true
  const types = SCOPE_TYPES[scope] ?? ['annual']
  return types === null || types.includes(user.membershipType)
}

function claimId(eventId, qid, option) {
  let h = 0x811c9dc5
  const s = qid + '\u0000' + option
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return `${eventId}_${h.toString(16)}`
}

// 先到先得: take the options this answer needs, then drop the ones it no longer
// uses. The where-update only moves a free row, so a race has exactly one winner.
async function claimExclusive(eventId, questions, answers, user) {
  const exclusives = (questions || []).filter(q => q.exclusive && q.type === 'single')
  if (!exclusives.length) return
  const mineSnap = await db.collection('eventClaims')
    .where({ eventId, uid: user._id }).limit(50).get().catch(() => ({ data: [] }))
  const held = new Set(mineSnap.data.map(r => r._id))
  const keep = new Set()

  for (const q of exclusives) {
    const option = answers[q.id]
    if (!option) continue
    const id = claimId(eventId, q.id, option)
    keep.add(id)
    if (held.has(id)) continue
    const got = await db.collection('eventClaims')
      .where({ _id: id, uid: null })
      .update({ data: { uid: user._id, displayName: user.displayName || '' } })
      .catch(() => ({ stats: { updated: 0 } }))
    if ((got.stats?.updated ?? 0) === 0) throw new Error(`「${option}」刚被人选走了，请换一个`)
  }

  await Promise.all(mineSnap.data.filter(r => !keep.has(r._id))
    .map(r => db.collection('eventClaims').doc(r._id).update({ data: { uid: null, displayName: '' } })))
}

function cleanAnswers(questions, raw) {
  const out = {}
  for (const q of questions || []) {
    const a = (raw || {})[q.id]
    if (q.type === 'text') {
      if (typeof a === 'string' && a.trim()) out[q.id] = a.trim().slice(0, 200)
    } else if (q.type === 'multi') {
      if (Array.isArray(a)) {
        const picked = a.filter(x => q.options.includes(x))
        if (picked.length) out[q.id] = picked
      }
    } else if (q.options.includes(a)) {
      out[q.id] = a
    }
    if (q.required && out[q.id] === undefined) {
      throw new Error(`请完成「${q.title}」`)
    }
  }
  return out
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { eventId, mode } = event

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('请先完善资料')

  const evSnap = await db.collection('events').doc(eventId).get().catch(() => ({ data: null }))
  const ev = evSnap.data
  if (!ev) throw new Error('event not found')

  const regId = eventId + '_' + user._id
  const existSnap = await db.collection('eventRegistrations').doc(regId).get().catch(() => ({ data: null }))
  const exist = existSnap.data

  // ── withdraw ───────────────────────────────────────────────────────────
  if (mode === 'withdraw') {
    if (!exist) throw new Error('registration not found')
    if (['closed', 'cancelled'].includes(ev.status)) throw new Error('活动已截止，如需变更请联系管理员')
    await db.collection('eventRegistrations').doc(regId).update({
      data: { status: 'withdrawn', guests: 0, guestNames: '' },
    })
    await db.collection('eventClaims').where({ eventId, uid: user._id })
      .update({ data: { uid: null, displayName: '' } }).catch(() => {})
    return { success: true }
  }

  if (!inScope(user, ev.scope)) {
    throw new Error(ev.scope === 'annual' ? '本活动仅限年卡会员参加' : '本活动仅限球队会员参加')
  }

  // ── polling: preference only, not a commitment ─────────────────────────
  if (mode === 'poll') {
    if (ev.status !== 'polling') throw new Error('投票已结束')
    const pollAnswers = cleanAnswers(ev.pollQuestions, event.pollAnswers)
    if (exist) {
      await db.collection('eventRegistrations').doc(regId).update({ data: { pollAnswers } })
    } else {
      await db.collection('eventRegistrations').doc(regId).set({
        data: {
          eventId,
          uid: user._id,
          displayName: user.displayName,
          status: 'polled',
          guests: 0,
          guestNames: '',
          pollAnswers,
          signupAnswers: {},
          registeredAt: db.serverDate(),
        },
      })
    }
    return { success: true }
  }

  // ── signup ─────────────────────────────────────────────────────────────
  if (ev.status !== 'registration') throw new Error('报名未开放')
  if (ev.deadline && Date.now() > ev.deadline) throw new Error('报名已截止')

  let guests = Math.max(0, parseInt(event.guests, 10) || 0)
  if (!ev.allowGuests) guests = 0
  if (guests > (ev.maxGuestsPer ?? 0)) throw new Error(`每人最多带 ${ev.maxGuestsPer} 位家属`)
  const guestNames = (event.guestNames || '').toString().trim().slice(0, 60)
  const signupAnswers = cleanAnswers(ev.signupQuestions, event.signupAnswers)

  if (ev.maxAttendees) {
    const regsSnap = await db.collection('eventRegistrations')
      .where({ eventId }).limit(300).get().catch(() => ({ data: [] }))
    const others = regsSnap.data.filter(r => r.uid !== user._id && r.status === 'confirmed')
    const taken = others.reduce((s, r) => s + 1 + (r.guests || 0), 0)
    if (taken + 1 + guests > ev.maxAttendees) {
      throw new Error(`名额不足：仅剩 ${Math.max(0, ev.maxAttendees - taken)} 个位置`)
    }
  }

  await claimExclusive(eventId, ev.signupQuestions, signupAnswers, user)

  const data = { status: 'confirmed', guests, guestNames, signupAnswers }
  if (exist) {
    await db.collection('eventRegistrations').doc(regId).update({ data })
  } else {
    await db.collection('eventRegistrations').doc(regId).set({
      data: {
        eventId,
        uid: user._id,
        displayName: user.displayName,
        pollAnswers: {},
        registeredAt: db.serverDate(),
        ...data,
      },
    })
  }
  return { success: true }
}
