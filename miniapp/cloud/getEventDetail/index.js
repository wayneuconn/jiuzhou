const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// Choice-question tallies are public (helps everyone converge on a date);
// free-text answers go to admins only.
function tally(questions, regs, answerField) {
  return (questions || []).map(q => {
    if (q.type === 'text') return { id: q.id, counts: [] }
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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { eventId } = event

  const [evSnap, regsSnap, userSnap] = await Promise.all([
    db.collection('events').doc(eventId).get().catch(() => ({ data: null })),
    db.collection('eventRegistrations').where({ eventId }).limit(300).get().catch(() => ({ data: [] })),
    OPENID ? db.collection('users').where({ openid: OPENID }).limit(1).get().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
  ])
  const ev = evSnap.data
  if (!ev) throw new Error('event not found')

  const caller = userSnap.data[0]
  const isAdmin = caller?.role === 'admin'

  // Visibility = scope: out-of-scope users (and anyone, for drafts) get a
  // minimal blocked response instead of the event content.
  if (!isAdmin) {
    const types = { annual: ['annual'], member: ['annual', 'per_session'], all: null }[ev.scope] ?? ['annual']
    const inScope = types === null || (caller && types.includes(caller.membershipType))
    if (ev.status === 'draft' || !inScope) {
      return { blocked: true, scope: ev.scope }
    }
  }

  const regs = regsSnap.data

  const polled = regs.filter(r => Object.keys(r.pollAnswers || {}).length > 0)
  const confirmed = regs.filter(r => r.status === 'confirmed')
  const headcount = confirmed.reduce((s, r) => s + 1 + (r.guests || 0), 0)

  const myReg = caller ? (regs.find(r => r.uid === caller._id) ?? null) : null

  return {
    event: { ...ev, id: ev._id },
    myReg,
    pollCount: polled.length,
    attendees: confirmed.map(r => ({ uid: r.uid, displayName: r.displayName, guests: r.guests || 0, guestNames: r.guestNames || '' })),
    headcount,
    pollTally: tally(ev.pollQuestions, regs, 'pollAnswers'),
    signupTally: tally(ev.signupQuestions, confirmed, 'signupAnswers'),
    callerInfo: caller ? { membershipType: caller.membershipType ?? 'none', role: caller.role ?? 'guest' } : null,
  }
}
