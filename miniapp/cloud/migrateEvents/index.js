// One-off migration for 活动 → 通用表单.
//
//   pollQuestions  → prepQuestions      status polling      → prep
//   signupQuestions→ questions          status registration → open
//   pollAnswers    → prepAnswers        status polled       → prepped
//   signupAnswers  → answers            status confirmed    → submitted
//
// allowGuests/maxGuestsPer were a hard-coded field; they become an ordinary
// number question (plus a text one for the names, if anybody filled it in),
// and each row's guests/guestNames move into that question's answer.
//
//   ./scripts/tcb.sh fn deploy migrateEvents -e "$JIUZHOU_ENV" --force
//   ./scripts/tcb.sh fn invoke migrateEvents -e "$JIUZHOU_ENV" \
//     --params '{"confirm":"MIGRATE_EVENTS"}'                   # dry run
//   ./scripts/tcb.sh fn invoke migrateEvents -e "$JIUZHOU_ENV" \
//     --params '{"confirm":"MIGRATE_EVENTS","apply":true}'      # for real
//
// Safe to re-run: a converted event is stamped with formMigratedAt. Delete the
// function once it has run.
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const GUESTS_Q = '_guests'
const GUEST_NAMES_Q = '_guestNames'
const STATUS = { polling: 'prep', registration: 'open' }
const REG_STATUS = { polled: 'prepped', confirmed: 'submitted' }

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    const snap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
    if (snap.data[0]?.role !== 'admin') throw new Error('admins only')
  }
  if (event.confirm !== 'MIGRATE_EVENTS') throw new Error('confirm required')
  const apply = event.apply === true

  const [evSnap, regSnap] = await Promise.all([
    db.collection('events').limit(300).get().catch(() => ({ data: [] })),
    db.collection('eventRegistrations').limit(500).get().catch(() => ({ data: [] })),
  ])

  const report = []
  for (const ev of evSnap.data) {
    if (ev.formMigratedAt) { report.push({ id: ev._id, title: ev.title, skipped: 'already migrated' }); continue }

    const rows = regSnap.data.filter(r => r.eventId === ev._id)
    const questions = [...(ev.signupQuestions || [])]
    const addedQuestions = []

    if (ev.allowGuests) {
      questions.push({
        id: GUESTS_Q, title: '带几位家属/朋友', type: 'number', options: [],
        required: false, max: Math.max(1, ev.maxGuestsPer || 1), countsSeats: true,
      })
      addedQuestions.push(GUESTS_Q)
      if (rows.some(r => (r.guestNames || '').trim())) {
        questions.push({ id: GUEST_NAMES_Q, title: '家属称呼', type: 'text', options: [], required: false })
        addedQuestions.push(GUEST_NAMES_Q)
      }
    }

    const data = {
      prepQuestions: ev.pollQuestions || [],
      questions,
      status: STATUS[ev.status] || ev.status,
      actionLabel: '报名',
      rosterVisibility: 'names',
      allowGuests: _.remove(),
      maxGuestsPer: _.remove(),
      pollQuestions: _.remove(),
      signupQuestions: _.remove(),
      formMigratedAt: Date.now(),
    }

    const regChanges = rows.map(r => {
      const answers = { ...(r.signupAnswers || {}) }
      if (ev.allowGuests && (r.guests || 0) > 0) answers[GUESTS_Q] = r.guests
      if (ev.allowGuests && (r.guestNames || '').trim()) answers[GUEST_NAMES_Q] = r.guestNames.trim()
      return {
        id: r._id,
        data: {
          prepAnswers: r.pollAnswers || {},
          answers,
          status: REG_STATUS[r.status] || r.status,
          pollAnswers: _.remove(),
          signupAnswers: _.remove(),
          guests: _.remove(),
          guestNames: _.remove(),
        },
      }
    })

    if (apply) {
      await db.collection('events').doc(ev._id).update({ data })
      for (const c of regChanges) await db.collection('eventRegistrations').doc(c.id).update({ data: c.data })
    }

    report.push({
      id: ev._id,
      title: ev.title,
      status: `${ev.status} → ${data.status}`,
      questions: questions.length,
      addedQuestions,
      registrations: regChanges.length,
    })
  }

  return { apply, events: report.length, report }
}
