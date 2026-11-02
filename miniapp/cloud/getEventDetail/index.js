const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// Choice tallies are public (that's what lets everyone converge); free text
// stays with the admins.
function tally(questions, regs, answerField) {
  return (questions || []).map(q => {
    if (q.type === 'text' || q.type === 'number') return { id: q.id, counts: [] }
    const counts = q.options.map(opt => ({
      option: opt,
      count: regs.filter(r => {
        const a = (r[answerField] || {})[q.id]
        return Array.isArray(a) ? a.includes(opt) : a === opt
      }).length,
    }))
    return { id: q.id, counts }
  })
}

function seatsOf(questions, answers) {
  return (questions || []).reduce((n, q) => {
    if (q.type !== 'number' || !q.countsSeats) return n
    return n + (Number((answers || {})[q.id]) || 0)
  }, 0)
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { eventId } = event

  const [evSnap, regsSnap, userSnap, claimsSnap] = await Promise.all([
    db.collection('events').doc(eventId).get().catch(() => ({ data: null })),
    db.collection('eventRegistrations').where({ eventId }).limit(300).get().catch(() => ({ data: [] })),
    OPENID ? db.collection('users').where({ openid: OPENID }).limit(1).get().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    db.collection('eventClaims').where({ eventId }).limit(300).get().catch(() => ({ data: [] })),
  ])
  const ev = evSnap.data
  if (!ev) throw new Error('event not found')

  const caller = userSnap.data[0]
  const isAdmin = caller?.role === 'admin'

  // Visibility = scope: out-of-scope users (and anyone, for drafts) get a
  // minimal blocked response instead of the content.
  if (!isAdmin) {
    const types = { annual: ['annual'], member: ['annual', 'per_session'], all: null }[ev.scope] ?? ['annual']
    const inScope = types === null || (caller && types.includes(caller.membershipType))
    if (ev.status === 'draft' || !inScope) {
      return { blocked: true, scope: ev.scope }
    }
  }

  const regs = regsSnap.data
  const prepped = regs.filter(r => Object.keys(r.prepAnswers || {}).length > 0)
  const submitted = regs.filter(r => r.status === 'submitted')
  const headcount = submitted.reduce((s, r) => s + 1 + seatsOf(ev.questions, r.answers), 0)

  const myReg = caller ? (regs.find(r => r.uid === caller._id) ?? null) : null

  // Who holds each 先到先得 option — public by design, that's what makes the
  // queue visible before you pick.
  const exclusiveTaken = {}
  for (const c of claimsSnap.data) {
    if (!c.uid) continue
    exclusiveTaken[c.qid] = exclusiveTaken[c.qid] || {}
    exclusiveTaken[c.qid][c.option] = { name: c.displayName || '已被选', mine: !!caller && c.uid === caller._id }
  }

  const visibility = ev.rosterVisibility ?? 'names'
  const roster = (visibility === 'names' || isAdmin)
    ? submitted.map(r => ({ uid: r.uid, displayName: r.displayName, seats: seatsOf(ev.questions, r.answers) }))
    : []

  return {
    event: { ...ev, id: ev._id },
    myReg,
    prepCount: prepped.length,
    roster,
    submittedCount: visibility === 'none' && !isAdmin ? null : submitted.length,
    headcount: visibility === 'none' && !isAdmin ? null : headcount,
    prepTally: tally(ev.prepQuestions, regs, 'prepAnswers'),
    tally: tally(ev.questions, submitted, 'answers'),
    exclusiveTaken,
    callerInfo: caller ? { membershipType: caller.membershipType ?? 'none', role: caller.role ?? 'guest' } : null,
  }
}
