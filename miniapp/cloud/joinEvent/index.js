const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const SCOPE_TYPES = { annual: ['annual'], member: ['annual', 'per_session'], all: null }

function inScope(user, scope) {
  if (user.role === 'admin') return true
  const types = SCOPE_TYPES[scope] ?? ['annual']
  return types === null || types.includes(user.membershipType)
}

// Extra seats a submission takes on top of the person themselves.
function seatsOf(questions, answers) {
  return (questions || []).reduce((n, q) => {
    if (q.type !== 'number' || !q.countsSeats) return n
    return n + (Number(answers[q.id]) || 0)
  }, 0)
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
    } else if (q.type === 'number') {
      const n = parseInt(a, 10)
      if (Number.isFinite(n) && n >= 0) out[q.id] = Math.min(n, q.max ?? 1)
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
  const verb = ev.actionLabel || '提交'

  // ── withdraw ───────────────────────────────────────────────────────────
  if (mode === 'withdraw') {
    if (!exist) throw new Error('没有找到你的记录')
    if (['closed', 'cancelled'].includes(ev.status)) throw new Error('已经截止了，如需变更请联系管理员')
    await db.collection('eventRegistrations').doc(regId).update({
      data: { status: 'withdrawn', answers: {} },
    })
    await db.collection('eventClaims').where({ eventId, uid: user._id })
      .update({ data: { uid: null, displayName: '' } }).catch(() => {})
    return { success: true }
  }

  if (!inScope(user, ev.scope)) {
    throw new Error(ev.scope === 'annual' ? '本表单仅限年卡会员参与' : '本表单仅限球队会员参与')
  }

  // ── first round: preference only, not a commitment ─────────────────────
  if (mode === 'prep') {
    if (ev.status !== 'prep') throw new Error('第一轮已结束')
    const prepAnswers = cleanAnswers(ev.prepQuestions, event.prepAnswers)
    if (exist) {
      await db.collection('eventRegistrations').doc(regId).update({ data: { prepAnswers } })
    } else {
      await db.collection('eventRegistrations').doc(regId).set({
        data: {
          eventId,
          uid: user._id,
          displayName: user.displayName,
          status: 'prepped',
          prepAnswers,
          answers: {},
          registeredAt: db.serverDate(),
        },
      })
    }
    return { success: true }
  }

  // ── main submission ────────────────────────────────────────────────────
  if (ev.status !== 'open') throw new Error(`还没开放${verb}`)
  if (ev.deadline && Date.now() > ev.deadline) throw new Error(`${verb}已截止`)

  const answers = cleanAnswers(ev.questions, event.answers)
  const seats = seatsOf(ev.questions, answers)

  if (ev.maxAttendees) {
    const regsSnap = await db.collection('eventRegistrations')
      .where({ eventId }).limit(300).get().catch(() => ({ data: [] }))
    const taken = regsSnap.data
      .filter(r => r.uid !== user._id && r.status === 'submitted')
      .reduce((s, r) => s + 1 + seatsOf(ev.questions, r.answers || {}), 0)
    if (taken + 1 + seats > ev.maxAttendees) {
      throw new Error(`名额不足：仅剩 ${Math.max(0, ev.maxAttendees - taken)} 个位置`)
    }
  }

  await claimExclusive(eventId, ev.questions, answers, user)

  const data = { status: 'submitted', answers }
  if (exist) {
    await db.collection('eventRegistrations').doc(regId).update({ data })
  } else {
    await db.collection('eventRegistrations').doc(regId).set({
      data: {
        eventId,
        uid: user._id,
        displayName: user.displayName,
        prepAnswers: {},
        registeredAt: db.serverDate(),
        ...data,
      },
    })
  }
  return { success: true }
}
