const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Returns how many minutes ET is behind UTC (300 for EST, 240 for EDT — handles DST)
function etOffsetMinutes(date) {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const etStr  = date.toLocaleString('en-US', { timeZone: 'America/New_York' })
  return Math.round((new Date(utcStr) - new Date(etStr)) / 60000)
}

// ET date string YYYY-MM-DD for a given UTC Date
function etDateStr(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const y = parts.find(p => p.type === 'year').value
  const m = parts.find(p => p.type === 'month').value.padStart(2, '0')
  const d = parts.find(p => p.type === 'day').value.padStart(2, '0')
  return `${y}-${m}-${d}`
}

function nextMatchDate(config) {
  const days = (config.recurringDays && config.recurringDays.length > 0)
    ? config.recurringDays : [config.recurringDayOfWeek ?? 0]
  const etHour = config.recurringHour ?? 19
  const etMin  = config.recurringMinute ?? 0

  const now = new Date()
  // "Fake" Date whose .getDay()/.getDate() etc. return ET values (parsed as server local)
  const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))

  for (let ahead = 1; ahead <= 14; ahead++) {
    const targetET = new Date(nowET)
    targetET.setDate(nowET.getDate() + ahead)
    if (!days.includes(targetET.getDay())) continue

    // UTC timestamp: ET midnight for this date + ET hours
    const utcBase   = new Date(Date.UTC(targetET.getFullYear(), targetET.getMonth(), targetET.getDate()))
    const offsetMin = etOffsetMinutes(utcBase)  // 300 (EST) or 240 (EDT)
    return new Date(utcBase.getTime() + offsetMin * 60000 + etHour * 3600000 + etMin * 60000)
  }

  // Fallback: 7 days from now
  const next = new Date(now)
  next.setDate(next.getDate() + 7)
  return next
}

function isInWinterBreak(date, config) {
  if (!config.winterBreakStart || !config.winterBreakEnd) return false
  return etDateStr(date) >= config.winterBreakStart && etDateStr(date) <= config.winterBreakEnd
}

exports.main = async (event, context) => {
  const now = new Date()

  const configSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const config = configSnap.data ?? {}
  const waitlistMinutes = config.waitlistConfirmMinutes ?? 30

  // ── 1. Expire promoted registration confirmations ────────────────────────
  const expiredRegsSnap = await db.collection('registrations')
    .where({ status: 'promoted', confirmDeadline: _.lt(now) })
    .get()
    .catch(() => ({ data: [] }))

  let promoted = 0
  for (const expired of expiredRegsSnap.data) {
    const { matchId, uid } = expired
    const regId = matchId + '_' + uid

    const nextSnap = await db.collection('registrations')
      .where({ matchId, status: 'waitlist' })
      .orderBy('waitlistPosition', 'asc')
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))

    const wlCountSnap = await db.collection('registrations')
      .where({ matchId, status: 'waitlist' })
      .count()
      .catch(() => ({ total: 0 }))
    const backPosition = (wlCountSnap.total ?? 0) + 1

    await db.collection('registrations').doc(regId).update({
      data: { status: 'waitlist', promotedAt: null, confirmDeadline: null, waitlistPosition: backPosition },
    }).catch(() => {})

    if (nextSnap.data.length > 0) {
      const next = nextSnap.data[0]
      const nextRegId = matchId + '_' + next.uid
      if (next.autoAccept) {
        await db.collection('registrations').doc(nextRegId).update({
          data: { status: 'confirmed', waitlistPosition: null, promotedAt: null, confirmDeadline: null },
        }).catch(() => {})
      } else {
        const deadline = new Date(Date.now() + waitlistMinutes * 60 * 1000)
        await db.collection('registrations').doc(nextRegId).update({
          data: { status: 'promoted', promotedAt: db.serverDate(), confirmDeadline: deadline, waitlistPosition: null },
        }).catch(() => {})
        try {
          const userSnap = await db.collection('users').doc(next.uid).get()
          if (userSnap.data?.openid) {
            await cloud.callFunction({
              name: 'sendSubscribeMsg',
              data: { type: 'promoted', toOpenid: userSnap.data.openid, data: { page: `/pages/match-detail/index?id=${matchId}`, templateData: {} } },
            })
          }
        } catch (_) {}
      }
    }
    promoted++
  }

  // ── 2. Auto-complete matches whose date has passed ───────────────────────
  const expiredMatchSnap = await db.collection('matches')
    .where({
      status: _.in(['registration_r1', 'registration_r2', 'drafting', 'ready']),
      date: _.lt(now.getTime()),
    })
    .get()
    .catch(() => ({ data: [] }))

  let autoCompleted = 0
  for (const match of expiredMatchSnap.data) {
    await db.collection('matches').doc(match._id).update({ data: { status: 'completed' } }).catch(() => {})

    const regsSnap = await db.collection('registrations')
      .where({ matchId: match._id, status: _.in(['confirmed', 'promoted']) })
      .get()
      .catch(() => ({ data: [] }))

    const attendeeUids = regsSnap.data.map(r => r.uid)
    if (attendeeUids.length > 0) {
      await Promise.all(attendeeUids.map(uid =>
        db.collection('users').doc(uid).update({ data: { attendanceCount: _.inc(1) } })
      ))
      await Promise.all(attendeeUids.map(uid =>
        db.collection('users').doc(uid).update({ data: { banGamesLeft: _.inc(-1) } }).catch(() => {})
      ))
      const negSnap = await db.collection('users')
        .where({ _id: _.in(attendeeUids), banGamesLeft: _.lt(0) })
        .get()
        .catch(() => ({ data: [] }))
      await Promise.all(negSnap.data.map(u =>
        db.collection('users').doc(u._id).update({ data: { banGamesLeft: 0 } })
      ))
    }
    autoCompleted++
  }

  // ── 3. Auto-generate next match if none upcoming ─────────────────────────
  if (config.autoRecurring) {
    const upcomingSnap = await db.collection('matches')
      .where({ status: _.in(['draft', 'registration_r1', 'registration_r2', 'drafting', 'ready']) })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))

    if (upcomingSnap.data.length === 0) {
      const nextDate = nextMatchDate(config)
      if (!isInWinterBreak(nextDate, config)) {
        await db.collection('matches').add({
          data: {
            date: nextDate.getTime(),
            location: config.recurringLocation ?? '待定',
            maxPlayers: config.recurringMaxPlayers ?? 22,
            status: 'draft',
            captainA: null,
            captainB: null,
            draftState: null,
            agreementText: config.defaultAgreementText ?? '',
            createdAt: db.serverDate(),
          },
        }).catch(() => {})
      }
    }
  }

  return { promoted, autoCompleted }
}
