const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Minutes ET is behind UTC (300 for EST, 240 for EDT — handles DST)
function etOffsetMinutes(date) {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const etStr = date.toLocaleString('en-US', { timeZone: 'America/New_York' })
  return Math.round((new Date(utcStr) - new Date(etStr)) / 60000)
}

// ET wall clock → epoch ms. The offset has to be read at the target instant,
// not at UTC midnight: on the two DST change days those differ by an hour.
function etWallClockTs(y, mo, d, h, mi) {
  const naive = Date.UTC(y, mo - 1, d, h || 0, mi || 0)
  const guess = naive + etOffsetMinutes(new Date(naive)) * 60000
  return naive + etOffsetMinutes(new Date(guess)) * 60000
}

// Match-day registration cutoff: 12:00 ET on the day of kickoff. After this,
// new signups queue for manual review and auto-promotion pauses — slots are
// filled only by captains/admins (bumpWaitlist).
function registrationCutoffTs(matchDate) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(matchDate))
  const y = Number(parts.find(p => p.type === 'year').value)
  const mo = Number(parts.find(p => p.type === 'month').value)
  const da = Number(parts.find(p => p.type === 'day').value)
  return etWallClockTs(y, mo, da, 12, 0)
}

async function nextWaitlistPosition(matchId) {
  const snap = await db.collection('registrations')
    .where({ matchId, status: 'waitlist' })
    .orderBy('waitlistPosition', 'desc')
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))
  return (snap.data[0]?.waitlistPosition ?? 0) + 1
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

// Queue order. Signups made before the match-day cutoff keep their membership
// priority; anything after it is appended by arrival alone, tier ignored.
function byQueueOrder(a, b) {
  const aLate = a.waitlistLate === true, bLate = b.waitlistLate === true
  return (aLate ? 1 : 0) - (bLate ? 1 : 0)
    || (aLate ? 0 : (a.waitlistTier ?? 1) - (b.waitlistTier ?? 1))
    || (a.waitlistPosition ?? 99) - (b.waitlistPosition ?? 99)
}

// Fill free slots from the waitlist in queue order. During R1 only annual
// (tier 1) waiters may come in — friends and 次卡 wait for R2.
async function promoteFromWaitlist(matchId, inheritTeam = null) {
  const matchSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
  const match = matchSnap.data
  if (!match) return
  if (!['registration_r1', 'registration_r2', 'ready'].includes(match.status)) return
  // After the match-day cutoff, slots are filled manually by captains/admins
  if (Date.now() >= registrationCutoffTs(match.date)) return
  const maxTier = match.status === 'registration_r1' ? 1 : 99

  const configSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const waitlistMinutes = configSnap.data?.waitlistConfirmMinutes ?? 30

  for (let guard = 0; guard < 50; guard++) {
    const cnt = await db.collection('registrations')
      .where({ matchId, status: _.in(['confirmed', 'promoted']) })
      .count().catch(() => ({ total: null }))
    if (cnt.total === null || cnt.total >= match.maxPlayers) break
    // Never leave the roster at 23: past 22 players are admitted in pairs, so
    // a lone 23rd waits for a 24th instead of taking the odd slot.
    const evenGate = cnt.total === 22 && match.maxPlayers > 22

    const waitSnap = await db.collection('registrations')
      .where({ matchId, status: 'waitlist' })
      .limit(100)
      .get()
      .catch(() => ({ data: [] }))
    const eligible = waitSnap.data
      .map(r => ({ ...r, _tier: r.waitlistTier ?? 1 }))
      .filter(r => r._tier <= maxTier)
      .sort(byQueueOrder)
    if (evenGate && eligible.length < 2) break
    const next = eligible[0]
    if (!next) break

    const regId = next._id
    // The replacement takes over the team of whoever vacated the slot, so a
    // post-draft withdrawal doesn't leave anyone unassigned.
    const teamPatch = inheritTeam ? { team: inheritTeam } : {}
    inheritTeam = null
    if (next.isGuest || next.autoAccept !== false) {
      await db.collection('registrations').doc(regId).update({
        data: { status: 'confirmed', waitlistPosition: null, promotedAt: null, confirmDeadline: null, ...teamPatch },
      }).catch(() => {})
      const notifyUid = next.isGuest ? next.broughtBy : null
      if (notifyUid) await notifyPromoted(matchId, match, notifyUid, waitlistMinutes, true)
    } else {
      const deadlineTs = Date.now() + waitlistMinutes * 60 * 1000
      await db.collection('registrations').doc(regId).update({
        data: { status: 'promoted', promotedAt: db.serverDate(), confirmDeadline: deadlineTs, waitlistPosition: null, ...teamPatch },
      }).catch(() => {})
      await notifyPromoted(matchId, match, next.uid, waitlistMinutes, false)
    }
  }
  await recalcMatchState(matchId)
}

// Best-effort admin alert (请假/退出) — consumes banked one-time subscribe
// quota; silently skipped when the template isn't configured or quota is dry.
async function notifyAdmins(matchId, match, text) {
  try {
    const [cnt, wl, adminsSnap] = await Promise.all([
      db.collection('registrations').where({ matchId, status: _.in(['confirmed', 'promoted']) }).count().catch(() => ({ total: 0 })),
      db.collection('registrations').where({ matchId, status: 'waitlist' }).count().catch(() => ({ total: 0 })),
      db.collection('users').where({ role: 'admin' }).limit(50).get().catch(() => ({ data: [] })),
    ])
    const d = new Date(match.date)
    const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
    const detail = `已报${cnt.total ?? 0}/${match.maxPlayers} 候补${wl.total ?? 0}`
    // 活动开始通知 fields: 活动名称 thing4, 活动内容 thing2, 活动时间 date5
    for (const admin of adminsSnap.data) {
      if (!admin.openid) continue
      try {
        await cloud.callFunction({
          name: 'sendSubscribeMsg',
          data: {
            type: 'adminAlert',
            toOpenid: admin.openid,
            data: {
              page: `/pages/match-detail/index?id=${matchId}`,
              templateData: {
                thing4: { value: text.slice(0, 20) },
                thing2: { value: detail.slice(0, 20) },
                date5: { value: timeStr },
              },
            },
          },
        })
      } catch (_) {}
    }
  } catch (_) {}
}

// After the cutoff a freed slot stays empty until someone pulls a waiter in,
// so admins + this match's captains get told who is waiting.
async function notifyOpenSlot(matchId, match, headline, excludeUid) {
  try {
    const wlSnap = await db.collection('registrations')
      .where({ matchId, status: 'waitlist' })
      .limit(100).get().catch(() => ({ data: [] }))
    if (wlSnap.data.length === 0) return false
    const names = wlSnap.data.sort(byQueueOrder).map(r => r.displayName || '?').join('、')
    const adminsSnap = await db.collection('users').where({ role: 'admin' }).limit(50).get().catch(() => ({ data: [] }))
    const recipients = new Map(adminsSnap.data.map(u => [u._id, u]))
    for (const uid of [match.captainA, match.captainB]) {
      if (!uid || recipients.has(uid)) continue
      const c = await db.collection('users').doc(uid).get().catch(() => ({ data: null }))
      if (c.data) recipients.set(uid, { ...c.data, _id: uid })
    }
    recipients.delete(excludeUid)
    const d = new Date(match.date)
    const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
    for (const u of recipients.values()) {
      if (!u.openid) continue
      try {
        await cloud.callFunction({
          name: 'sendSubscribeMsg',
          data: {
            type: 'adminAlert',
            toOpenid: u.openid,
            data: {
              page: `/pages/match-detail/index?id=${matchId}`,
              templateData: {
                thing4: { value: `${headline}，请从候补拉人`.slice(0, 20) },
                thing2: { value: `候补：${names}`.slice(0, 20) },
                date5: { value: timeStr },
              },
            },
          },
        })
      } catch (_) {}
    }
    return true
  } catch (_) { return false }
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
  const { OPENID } = cloud.getWXContext()
  const { matchId, mode } = event
  const newStatus = mode === 'excuse' ? 'excused' : 'withdrawn'

  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('user not found')

  const matchSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
  const match = matchSnap.data
  if (!match) throw new Error('match not found')
  if (match.status === 'completed' || match.status === 'cancelled') {
    throw new Error('比赛已结束，无法退出')
  }

  // ── remove a friend I brought (or any guest, if admin) ─────────────────────
  if (event.friendUid) {
    const fRegId = matchId + '_' + event.friendUid
    const fSnap = await db.collection('registrations').doc(fRegId).get().catch(() => ({ data: null }))
    if (!fSnap.data || !fSnap.data.isGuest) throw new Error('friend registration not found')
    if (fSnap.data.broughtBy !== user._id && user.role !== 'admin') {
      throw new Error('只能移除自己带的朋友')
    }
    const freedSlot = ['confirmed', 'promoted'].includes(fSnap.data.status)
    const freedTeam = freedSlot ? (fSnap.data.team ?? null) : null
    await db.collection('registrations').doc(fRegId).update({
      data: { status: 'withdrawn', waitlistPosition: null, promotedAt: null, confirmDeadline: null, team: null },
    })
    if (freedSlot) await promoteFromWaitlist(matchId, freedTeam)
    else await recalcMatchState(matchId)
    if (freedSlot && Date.now() >= registrationCutoffTs(match.date)) {
      await notifyOpenSlot(matchId, match, `${fSnap.data.displayName ?? '朋友'} 退出了`, user._id)
    }
    return { success: true }
  }

  // Admin removal of any player (代报的散户不来了、或任何需要清理的名额)
  const targetId = event.targetUid && event.targetUid !== user._id ? event.targetUid : user._id
  if (targetId !== user._id && user.role !== 'admin') throw new Error('admins only')

  const regId = matchId + '_' + targetId
  const regSnap = await db.collection('registrations').doc(regId).get().catch(() => ({ data: null }))
  if (!regSnap.data) throw new Error('registration not found')

  const wasConfirmed = ['confirmed', 'promoted'].includes(regSnap.data.status)
  const vacatedTeam = wasConfirmed ? (regSnap.data.team ?? null) : null

  await db.collection('registrations').doc(regId).update({
    data: { status: newStatus, waitlistPosition: null, promotedAt: null, confirmDeadline: null, team: null },
  })

  // If they were a captain, clear that slot
  const clearData = {}
  if (match.captainA === targetId) clearData.captainA = null
  if (match.captainB === targetId) clearData.captainB = null
  if (Object.keys(clearData).length > 0) {
    // If currently drafting, also reset draftState (drafting cannot proceed without both captains)
    if (match.status === 'drafting') {
      clearData.status = 'registration_r2'
      clearData.draftState = null
    }
    await db.collection('matches').doc(matchId).update({ data: clearData }).catch(() => {})
  }
  // (No auto-completion mid-draft: captains end the draft explicitly.)

  // The bringer left — their friends lose the tier-2 privilege and re-queue
  // as ordinary tier-3 waiters (a confirmed friend gives the slot back; the
  // flush below re-fills it by priority, which may re-admit the friend if
  // nobody outranks them).
  const friendsSnap = await db.collection('registrations')
    .where({ matchId, broughtBy: targetId, isGuest: true, status: _.in(['confirmed', 'promoted', 'waitlist']) })
    .get().catch(() => ({ data: [] }))
  let friendFreedSlot = false
  for (const f of friendsSnap.data) {
    if (['confirmed', 'promoted'].includes(f.status)) friendFreedSlot = true
    const pos = await nextWaitlistPosition(matchId)
    await db.collection('registrations').doc(f._id).update({
      data: {
        status: 'waitlist',
        waitlistTier: 3,
        waitlistLate: Date.now() >= registrationCutoffTs(match.date),
        waitlistPosition: pos,
        promotedAt: null,
        confirmDeadline: null,
        team: null,
      },
    }).catch(() => {})
  }

  if (wasConfirmed || friendFreedSlot) await promoteFromWaitlist(matchId, vacatedTeam)
  else await recalcMatchState(matchId)

  // A confirmed player leaving is what admins need to know about (补位);
  // skip when an admin removed them — the admin already knows.
  const leftName = `${regSnap.data.displayName ?? '有人'} ${newStatus === 'excused' ? '请假' : '退出'}了`
  const alerted = (wasConfirmed || friendFreedSlot) && Date.now() >= registrationCutoffTs(match.date)
    ? await notifyOpenSlot(matchId, match, leftName, user._id)
    : false
  if (wasConfirmed && targetId === user._id && !alerted) {
    await notifyAdmins(matchId, match, leftName)
  }
  return { success: true }
}
