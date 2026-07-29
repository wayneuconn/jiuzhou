const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Waitlist priority tiers: 1 = annual self, 2 = friend brought by annual,
// 3 = per_session/other. Promotion always drains lower tiers first.
function tierFor(user) {
  if (user.role === 'admin' || user.membershipType === 'annual') return 1
  return 3
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
  if (count >= match.maxPlayers && match.status !== 'ready') {
    await db.collection('matches').doc(matchId).update({ data: { status: 'ready', autoReady: true } }).catch(() => {})
  } else if (match.status === 'ready' && count < match.maxPlayers && match.autoReady === true) {
    await db.collection('matches').doc(matchId).update({ data: { status: 'registration_r2', autoReady: false } }).catch(() => {})
  }
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

// Pending waiters that outrank (or tie) the given tier — a direct confirmation
// must not jump this queue.
async function higherPriorityWaiting(matchId, tier) {
  const snap = await db.collection('registrations')
    .where({ matchId, status: 'waitlist' })
    .limit(100)
    .get()
    .catch(() => ({ data: [] }))
  return snap.data.some(r => (r.waitlistTier ?? 1) <= tier)
}

// Fill free slots from the waitlist by (tier, position). During R1 only
// annual (tier 1) waiters may come in — friends and 次卡 wait for R2.
async function promoteFromWaitlist(matchId) {
  const matchSnap = await db.collection('matches').doc(matchId).get().catch(() => ({ data: null }))
  const match = matchSnap.data
  if (!match) return
  if (!['registration_r1', 'registration_r2', 'ready'].includes(match.status)) return
  const maxTier = match.status === 'registration_r1' ? 1 : 99

  const configSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const waitlistMinutes = configSnap.data?.waitlistConfirmMinutes ?? 30

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
      // Guests can't open the app — notify whoever brought them
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

// Best-effort admin alert (满员) — consumes banked one-time subscribe quota;
// silently skipped when the template isn't configured or quota is dry.
async function notifyAdminsFull(matchId, match) {
  try {
    const adminsSnap = await db.collection('users').where({ role: 'admin' }).limit(50).get().catch(() => ({ data: [] }))
    const d = new Date(match.date)
    const timeStr = d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
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
                thing4: { value: '报名已满员' },
                thing2: { value: `已报${match.maxPlayers}/${match.maxPlayers}`.slice(0, 20) },
                date5: { value: timeStr },
              },
            },
          },
        })
      } catch (_) {}
    }
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
            thing6: { value: isGuestNotice ? '你带的朋友已递补进名单' : `请在 ${waitlistMinutes} 分钟内确认报名` },
          },
        },
      },
    })
  } catch (_) {}
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { matchId } = event

  const [userSnap, matchSnap, confirmedSnap] = await Promise.all([
    db.collection('users').where({ openid: OPENID }).limit(1).get(),
    db.collection('matches').doc(matchId).get(),
    db.collection('registrations')
      .where({ matchId, status: _.in(['confirmed', 'promoted']) })
      .count(),
  ])

  const user = userSnap.data[0]
  const match = matchSnap.data

  if (!user || !match) throw new Error('user or match not found')
  // Full roster auto-flips the match to ready (autoReady) — the WAITLIST must
  // stay joinable then. Only the hard lock (kickoff-1h / manual force-ready,
  // autoReady false) closes everything.
  const regOpen = ['registration_r1', 'registration_r2'].includes(match.status)
  const waitlistOnlyOpen = match.status === 'ready' && match.autoReady === true
  if (!regOpen && !waitlistOnlyOpen) {
    throw new Error('registration not open')
  }

  // ── bring-a-friend: annual members with an active own registration ────────
  if (event.friendName !== undefined) {
    const friendName = (event.friendName || '').toString().trim().slice(0, 20)
    if (!friendName) throw new Error('请填写朋友称呼')
    const friendPositions = Array.isArray(event.friendPositions)
      ? event.friendPositions.filter(p => typeof p === 'string').slice(0, 3)
      : []
    if (friendPositions.length === 0) throw new Error('请为朋友选至少一个位置')
    if (user.role !== 'admin' && user.membershipType !== 'annual') {
      throw new Error('仅年卡会员可以带朋友')
    }
    const myReg = await db.collection('registrations').doc(matchId + '_' + user._id).get().catch(() => ({ data: null }))
    if (!myReg.data || !['confirmed', 'promoted'].includes(myReg.data.status)) {
      throw new Error('请先完成自己的报名再带朋友')
    }
    const myFriendsSnap = await db.collection('registrations')
      .where({ matchId, broughtBy: user._id, status: _.in(['confirmed', 'promoted', 'waitlist']) })
      .count().catch(() => ({ total: 0 }))
    if ((myFriendsSnap.total ?? 0) >= 2) throw new Error('每人最多带 2 位朋友')

    const friendUid = 'friend_' + Math.random().toString(36).slice(2, 10)
    const position = await nextWaitlistPosition(matchId)
    await db.collection('registrations').doc(matchId + '_' + friendUid).set({
      data: {
        matchId,
        uid: friendUid,
        displayName: friendName,
        preferredPositions: friendPositions,
        registeredAt: db.serverDate(),
        status: 'waitlist',
        waitlistPosition: position,
        waitlistTier: 2,
        isGuest: true,
        broughtBy: user._id,
        broughtByName: user.displayName,
        team: null,
        tags: [],
        autoAccept: true,
      },
    })
    await promoteFromWaitlist(matchId)
    const check = await db.collection('registrations').doc(matchId + '_' + friendUid).get().catch(() => ({ data: null }))
    return { status: check.data?.status === 'confirmed' ? 'confirmed' : 'waitlist', friendUid }
  }

  // ── self registration ──────────────────────────────────────────────────────
  const myTier = tierFor(user)
  const isR1 = match.status === 'registration_r1'
  if (isR1 && myTier !== 1 && user.membershipType !== 'per_session') {
    throw new Error('R1 阶段仅年卡可报名、次卡可候补，请等待 R2 开放')
  }
  if (user.banGamesLeft > 0) {
    throw new Error(`账号已被禁赛，还剩 ${user.banGamesLeft} 场`)
  }

  const confirmedCount = confirmedSnap.total ?? 0
  // Waitlist when: full (incl. full-locked ready state), or R1 as 次卡
  // (annual-only round), or someone with equal/higher priority is already
  // waiting (no queue jumping).
  const mustWait = confirmedCount >= match.maxPlayers
    || waitlistOnlyOpen
    || (isR1 && myTier !== 1)
    || await higherPriorityWaiting(matchId, myTier)

  const regId = matchId + '_' + user._id
  const existingSnap = await db.collection('registrations').doc(regId).get().catch(() => ({ data: null }))

  if (existingSnap.data) {
    if (['confirmed', 'promoted', 'waitlist'].includes(existingSnap.data.status)) {
      throw new Error('already registered')
    }
    // Re-register after withdrawal/excused. Behavior tags kept.
    const reAutoAccept = typeof event.autoAccept === 'boolean'
      ? event.autoAccept
      : (existingSnap.data.autoAccept ?? true)
    await db.collection('registrations').doc(regId).update({
      data: {
        status: mustWait ? 'waitlist' : 'confirmed',
        waitlistPosition: mustWait ? await nextWaitlistPosition(matchId) : null,
        waitlistTier: myTier,
        registeredAt: db.serverDate(),
        autoAccept: reAutoAccept,
      },
    })
    let reStatus = mustWait ? 'waitlist' : 'confirmed'
    if (!mustWait) reStatus = await resolveOverflow(matchId, regId, match.maxPlayers)
    await promoteFromWaitlist(matchId)
    // Edge-trigger: this signup just filled the roster
    if (reStatus === 'confirmed' && confirmedCount + 1 >= match.maxPlayers) {
      await notifyAdminsFull(matchId, match)
    }
    return { status: reStatus }
  }

  await db.collection('registrations').doc(regId).set({
    data: {
      matchId,
      uid: user._id,
      displayName: user.displayName,
      preferredPositions: user.preferredPositions ?? [],
      registeredAt: db.serverDate(),
      status: mustWait ? 'waitlist' : 'confirmed',
      waitlistPosition: mustWait ? await nextWaitlistPosition(matchId) : null,
      waitlistTier: myTier,
      team: null,
      tags: [],
      autoAccept: typeof event.autoAccept === 'boolean' ? event.autoAccept : true,
    },
  })

  let status = mustWait ? 'waitlist' : 'confirmed'
  if (!mustWait) status = await resolveOverflow(matchId, regId, match.maxPlayers)
  await promoteFromWaitlist(matchId)
  // Edge-trigger: this signup just filled the roster
  if (status === 'confirmed' && confirmedCount + 1 >= match.maxPlayers) {
    await notifyAdminsFull(matchId, match)
  }
  return { status }
}

// Concurrent registrations can both pass the capacity pre-check. After
// confirming, recount; if the roster overshot and we're among the newest
// confirmations, demote ourselves back to the waitlist.
async function resolveOverflow(matchId, regId, maxPlayers) {
  const confirmedSnap = await db.collection('registrations')
    .where({ matchId, status: _.in(['confirmed', 'promoted']) })
    .count().catch(() => ({ total: 0 }))
  const total = confirmedSnap.total ?? 0
  if (total <= maxPlayers) return 'confirmed'

  const overflow = total - maxPlayers
  const newestSnap = await db.collection('registrations')
    .where({ matchId, status: 'confirmed' })
    .orderBy('registeredAt', 'desc')
    .limit(overflow)
    .get()
    .catch(() => ({ data: [] }))
  const amNewest = newestSnap.data.some(r => r._id === regId)
  if (!amNewest) return 'confirmed'

  const position = await nextWaitlistPosition(matchId)
  await db.collection('registrations').doc(regId).update({
    data: { status: 'waitlist', waitlistPosition: position },
  })
  return 'waitlist'
}
