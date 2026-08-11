const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Match-day registration cutoff: 14:00 ET on the day of kickoff. After this,
// new signups queue for manual review and auto-promotion pauses — slots are
// filled only by captains/admins (bumpWaitlist).
function registrationCutoffTs(matchDate) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(matchDate))
  const y = Number(parts.find(p => p.type === 'year').value)
  const mo = Number(parts.find(p => p.type === 'month').value)
  const da = Number(parts.find(p => p.type === 'day').value)
  const utcBase = new Date(Date.UTC(y, mo - 1, da))
  return utcBase.getTime() + etOffsetMinutes(utcBase) * 60000 + 14 * 3600000
}

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

async function recalcMatchState(matchId) {
  const matchSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
  if (!matchSnap.data) return
  const match = matchSnap.data
  if (!['registration_r1', 'registration_r2', 'ready'].includes(match.status)) return
  const cnt = await db.collection('registrations')
    .where({ matchId, status: _.in(['confirmed', 'promoted']) })
    .count().catch(() => ({ total: 0 }))
  const count = cnt.total ?? 0
  // Full no longer auto-flips to ready — capacity checks in registerForMatch
  // keep the roster capped while the waitlist stays joinable (this also keeps
  // already-released frontends working: they close everything on 'ready').
  if (match.status === 'ready' && count < match.maxPlayers && match.autoReady === true) {
    await db.collection('matches').doc(matchId).update({ data: { status: 'registration_r2', autoReady: false } }).catch(() => {})
  }
}

function isInWinterBreak(date, config) {
  if (!config.winterBreakStart || !config.winterBreakEnd) return false
  return etDateStr(date) >= config.winterBreakStart && etDateStr(date) <= config.winterBreakEnd
}

// Fill free slots from the waitlist by (tier, position). During R1 only
// annual (tier 1) waiters may come in — friends and 次卡 wait for R2.
async function promoteFromWaitlist(matchId, waitlistMinutes) {
  const matchSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
  const match = matchSnap.data
  if (!match) return
  if (!['registration_r1', 'registration_r2', 'ready'].includes(match.status)) return
  // After the match-day cutoff, slots are filled manually by captains/admins
  if (Date.now() >= registrationCutoffTs(match.date)) return
  const maxTier = match.status === 'registration_r1' ? 1 : 99

  for (let guard = 0; guard < 50; guard++) {
    const cnt = await db.collection('registrations')
      .where({ matchId, status: _.in(['confirmed', 'promoted']) })
      .count().catch(() => ({ total: null }))
    if (cnt.total === null || cnt.total >= match.maxPlayers) break

    const waitSnap = await db.collection('registrations')
      .where({ matchId, status: 'waitlist' })
      .limit(100)
      .get()
      .catch(() => ({ data: [] }))
    const next = waitSnap.data
      .map(r => ({ ...r, _tier: r.waitlistTier ?? 1 }))
      .filter(r => r._tier <= maxTier)
      .sort((a, b) => a._tier - b._tier || (a.waitlistPosition ?? 99) - (b.waitlistPosition ?? 99))[0]
    if (!next) break

    const regId = next._id
    if (next.isGuest || next.autoAccept !== false) {
      await db.collection('registrations').doc(regId).update({
        data: { status: 'confirmed', waitlistPosition: null, promotedAt: null, confirmDeadline: null },
      }).catch(() => {})
      const notifyUid = next.isGuest ? next.broughtBy : null
      if (notifyUid) await notifyPromoted(matchId, match, notifyUid, waitlistMinutes, true)
    } else {
      const deadlineTs = Date.now() + waitlistMinutes * 60 * 1000
      await db.collection('registrations').doc(regId).update({
        data: { status: 'promoted', promotedAt: db.serverDate(), confirmDeadline: deadlineTs, waitlistPosition: null },
      }).catch(() => {})
      await notifyPromoted(matchId, match, next.uid, waitlistMinutes, false)
    }
  }
  await recalcMatchState(matchId)
}

// Registration-open broadcast: R1 → annual members, R2 → 次卡. Skips users
// already on the roster/waitlist; best-effort, consumes each user's banked
// one-time subscribe quota (活动开始通知 fields thing4/thing2/date5).
async function notifyMatchOpen(matchId, match, membershipType, text) {
  try {
    const [usersSnap, regsSnap] = await Promise.all([
      db.collection('users').where({ membershipType }).limit(200).get().catch(() => ({ data: [] })),
      db.collection('registrations')
        .where({ matchId, status: _.in(['confirmed', 'promoted', 'waitlist']) })
        .limit(100).get().catch(() => ({ data: [] })),
    ])
    const registered = new Set(regsSnap.data.map(r => r.uid))
    const d = new Date(match.date)
    const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
    await Promise.all(usersSnap.data
      .filter(u => u.openid && !registered.has(u._id))
      .map(u => cloud.callFunction({
        name: 'sendSubscribeMsg',
        data: {
          type: 'matchOpen',
          toOpenid: u.openid,
          data: {
            page: `/pages/match-detail/index?id=${matchId}`,
            templateData: {
              thing4: { value: text.slice(0, 20) },
              thing2: { value: (match.location || '待定').slice(0, 20) },
              date5: { value: timeStr },
            },
          },
        },
      }).catch(() => {})))
  } catch (_) {}
}

async function notifyPromoted(matchId, match, uid, waitlistMinutes, isGuestNotice) {
  try {
    const uSnap = await db.collection('users').doc(uid).get().catch(() => ({ data: null }))
    if (!uSnap.data?.openid) return
    const d = new Date(match.date)
    const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
    await cloud.callFunction({
      name: 'sendSubscribeMsg',
      data: {
        type: 'promoted',
        toOpenid: uSnap.data.openid,
        data: {
          page: `/pages/match-detail/index?id=${matchId}`,
          templateData: {
            thing2: { value: '九州足球比赛' },
            time4: { value: timeStr },
            thing5: { value: (match.location || '待定').slice(0, 20) },
            thing6: { value: isGuestNotice ? '朋友已递补进名单,请联系管理员确认' : `请在 ${waitlistMinutes} 分钟内确认报名` },
          },
        },
      },
    })
  } catch (_) {}
}

exports.main = async (event, context) => {
  const now = new Date()

  const configSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const config = configSnap.data ?? {}
  const waitlistMinutes = config.waitlistConfirmMinutes ?? 30

  // ── 1. Expire promoted registration confirmations ────────────────────────
  // confirmDeadline is stored as a number (ms) — compare with a number, not a Date.
  const expiredRegsSnap = await db.collection('registrations')
    .where({ status: 'promoted', confirmDeadline: _.lt(now.getTime()) })
    .get()
    .catch(() => ({ data: [] }))

  let promoted = 0
  for (const expired of expiredRegsSnap.data) {
    const { matchId, uid } = expired
    const regId = matchId + '_' + uid

    // Positions are never compacted, so use max+1 to avoid duplicates.
    const wlMaxSnap = await db.collection('registrations')
      .where({ matchId, status: 'waitlist' })
      .orderBy('waitlistPosition', 'desc')
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    const backPosition = (wlMaxSnap.data[0]?.waitlistPosition ?? 0) + 1

    await db.collection('registrations').doc(regId).update({
      data: { status: 'waitlist', promotedAt: null, confirmDeadline: null, waitlistPosition: backPosition, team: null },
    }).catch(() => {})

    await promoteFromWaitlist(matchId, waitlistMinutes)
    promoted++
  }

  // ── 1b. Auto-advance R1 → R2 within 8 hours of kickoff ──────────────────
  const eightHoursMs = 8 * 60 * 60 * 1000
  const r1Snap = await db.collection('matches')
    .where({ status: 'registration_r1', date: _.and(_.gt(now.getTime()), _.lt(now.getTime() + eightHoursMs)) })
    .get().catch(() => ({ data: [] }))
  let advancedToR2 = 0
  for (const m of r1Snap.data) {
    await db.collection('matches').doc(m._id).update({ data: { status: 'registration_r2' } }).catch(() => {})
    // R2 lifts the annual-only gate — drain friends/次卡 from the waitlist,
    // then tell 次卡 members registration is open for them
    await promoteFromWaitlist(m._id, waitlistMinutes)
    await notifyMatchOpen(m._id, m, 'per_session', 'R2 全员报名已开放')
    advancedToR2++
  }

  // ── 1c. Lock roster 1 hour before kickoff ───────────────────────────────
  const oneHourMs = 60 * 60 * 1000
  const cutoffSnap = await db.collection('matches')
    .where({
      status: _.in(['registration_r1', 'registration_r2']),
      date: _.and(_.gt(now.getTime()), _.lt(now.getTime() + oneHourMs)),
    })
    .get().catch(() => ({ data: [] }))
  let locked = 0
  for (const m of cutoffSnap.data) {
    // rosterLocked distinguishes the kickoff-1h hard lock from a manual
    // 选人结束 (both land on ready) — the waitlist stays open for the latter.
    await db.collection('matches').doc(m._id).update({ data: { status: 'ready', autoReady: false, rosterLocked: true } }).catch(() => {})
    locked++
  }

  // ── 1d. Even-roster rule at the match-day cutoff (14:00 ET) ─────────────
  // If the roster sits at exactly 23 when the cutoff passes, the newest
  // confirmed non-captain drops to the HEAD of the waitlist (tier 0) so the
  // game runs 22 — and they're first back in if a 24th appears via manual bump.
  const evenRosterSnap = await db.collection('matches')
    .where({
      status: _.in(['registration_r1', 'registration_r2']),
      date: _.gt(now.getTime()),
    })
    .get().catch(() => ({ data: [] }))
  let evenRostered = 0
  for (const m of evenRosterSnap.data) {
    if (m.evenRosterApplied === true) continue
    if (now.getTime() < registrationCutoffTs(m.date)) continue
    await db.collection('matches').doc(m._id).update({ data: { evenRosterApplied: true } }).catch(() => {})

    const cntSnap = await db.collection('registrations')
      .where({ matchId: m._id, status: _.in(['confirmed', 'promoted']) })
      .count().catch(() => ({ total: 0 }))
    if ((cntSnap.total ?? 0) !== 23) continue

    const newestSnap = await db.collection('registrations')
      .where({
        matchId: m._id,
        status: 'confirmed',
        uid: _.nin([m.captainA ?? '__none__', m.captainB ?? '__none__']),
      })
      .orderBy('registeredAt', 'desc')
      .limit(1)
      .get().catch(() => ({ data: [] }))
    const demoted = newestSnap.data[0]
    if (!demoted) continue

    await db.collection('registrations').doc(demoted._id).update({
      data: { status: 'waitlist', waitlistTier: 0, waitlistPosition: 0, team: null, promotedAt: null, confirmDeadline: null },
    }).catch(() => {})

    // Tell the player (or the bringer, for a guest)
    try {
      const notifyUid = demoted.isGuest ? demoted.broughtBy : demoted.uid
      const uSnap = notifyUid ? await db.collection('users').doc(notifyUid).get().catch(() => ({ data: null })) : { data: null }
      if (uSnap.data?.openid) {
        const d = new Date(m.date)
        const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
        await cloud.callFunction({
          name: 'sendSubscribeMsg',
          data: {
            type: 'promoted',
            toOpenid: uSnap.data.openid,
            data: {
              page: `/pages/match-detail/index?id=${m._id}`,
              templateData: {
                thing2: { value: '九州足球比赛' },
                time4: { value: timeStr },
                thing5: { value: (m.location || '待定').slice(0, 20) },
                thing6: { value: demoted.isGuest ? '未满24人,你的朋友转为候补' : '未满24人,你暂转为候补首位' },
              },
            },
          },
        })
      }
    } catch (_) {}
    evenRostered++
  }

  // ── 1e. Close one-off events past their signup deadline ─────────────────
  const dueEventsSnap = await db.collection('events')
    .where({ status: 'registration', deadline: _.and(_.gt(0), _.lt(now.getTime())) })
    .get().catch(() => ({ data: [] }))
  for (const ev of dueEventsSnap.data) {
    await db.collection('events').doc(ev._id).update({ data: { status: 'closed' } }).catch(() => {})
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

    // Attendance for players who actually held a spot (promoted-but-unconfirmed excluded)
    const regsSnap = await db.collection('registrations')
      .where({ matchId: match._id, status: 'confirmed' })
      .get()
      .catch(() => ({ data: [] }))
    for (const reg of regsSnap.data) {
      await db.collection('users').doc(reg.uid).update({
        data: { attendanceCount: _.inc(1) },
      }).catch(() => {})
    }

    // A completed match counts toward every active ban — banned players can't
    // register, so the ban must tick down for non-attendees.
    await db.collection('users')
      .where({ banGamesLeft: _.gt(0) })
      .update({ data: { banGamesLeft: _.inc(-1) } })
      .catch(() => {})

    autoCompleted++
  }

  // ── 3. Auto-generate next match if none upcoming ─────────────────────────
  if (config.autoRecurring) {
    const activeSnap = await db.collection('matches')
      .where({ status: _.in(['registration_r1', 'registration_r2', 'drafting', 'ready']) })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    // A future draft counts as upcoming (admin is preparing it); a forgotten
    // past-dated draft must not silently block the recurring schedule.
    const futureDraftSnap = activeSnap.data.length > 0
      ? { data: [] }
      : await db.collection('matches')
          .where({ status: 'draft', date: _.gt(now.getTime()) })
          .limit(1)
          .get()
          .catch(() => ({ data: [] }))

    if (activeSnap.data.length === 0 && futureDraftSnap.data.length === 0) {
      const nextDate = nextMatchDate(config)
      if (!isInWinterBreak(nextDate, config)) {
        const created = await db.collection('matches').add({
          data: {
            date: nextDate.getTime(),
            location: config.recurringLocation ?? '待定',
            maxPlayers: config.recurringMaxPlayers ?? 22,
            status: 'registration_r1',
            autoReady: false,
            captainA: null,
            captainB: null,
            agreementText: config.defaultAgreementText ?? '',
            createdAt: db.serverDate(),
          },
        }).catch(() => null)
        // New match opens directly in R1 — tell annual members
        if (created?._id) {
          await notifyMatchOpen(created._id, {
            date: nextDate.getTime(),
            location: config.recurringLocation ?? '待定',
          }, 'annual', '新比赛开放报名(R1)')
        }
      }
    }
  }

  return { promoted, autoCompleted }
}
