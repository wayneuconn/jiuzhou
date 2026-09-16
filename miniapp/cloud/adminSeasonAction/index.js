// 赛季年卡登记 — admin side.
//
// 年卡 is granted per season (users.annualSeason). A drive collects who wants
// to continue into the next season; rollover then downgrades every annual that
// didn't register to 次卡, so they keep playing but lose R1 priority and the
// bring-a-friend allowance — which is the incentive to register.
//
// Rollover is deliberately a button, never a date: tierFor() reads
// membershipType in four cloud functions, and letting priority flip on a
// timer would silently change who can register mid-match-week.
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function toMs(v) {
  if (v && typeof v === 'object' && v._seconds) return v._seconds * 1000
  if (v instanceof Date) return v.getTime()
  return v ?? null
}

const SEASON_RE = /^[0-9A-Za-z一-龥-]{1,20}$/

// Same shape and limits as the event system's questions (adminSaveEvent), so
// the admin builder and the player pickers are literally the same UI.
function cleanQuestions(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, 10).map((q, i) => ({
    id: (q.id || `q${i}_${Math.random().toString(36).slice(2, 6)}`).toString().slice(0, 20),
    title: (q.title || '').toString().trim().slice(0, 50),
    type: ['single', 'multi', 'text'].includes(q.type) ? q.type : 'single',
    options: q.type === 'text' ? [] : (Array.isArray(q.options) ? q.options.map(o => o.toString().trim().slice(0, 30)).filter(Boolean).slice(0, 12) : []),
    required: q.required !== false,
  })).filter(q => q.title && (q.type === 'text' || q.options.length >= 2))
}

// Best-effort nudge to the players a drive concerns (活动开始通知 template).
async function notifyDriveOpen(season, drive, uids) {
  const deadlineStr = drive.deadline
    ? new Date(drive.deadline).toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
    : new Date().toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
  for (const uid of uids) {
    const uSnap = await db.collection('users').doc(uid).get().catch(() => ({ data: null }))
    if (!uSnap.data?.openid) continue
    await cloud.callFunction({
      name: 'sendSubscribeMsg',
      data: {
        type: 'matchOpen',
        toOpenid: uSnap.data.openid,
        data: {
          page: '/pages/profile/index',
          templateData: {
            thing4: { value: `${season} 赛季年卡登记已开放`.slice(0, 20) },
            thing2: { value: '请在「我的」页确认是否继续'.slice(0, 20) },
            date5: { value: deadlineStr },
          },
        },
      },
    }).catch(() => {})
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const callerSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = callerSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const { action } = event
  const cfgSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const currentSeason = cfgSnap.data?.season ?? ''

  // ── board: everything the 赛季管理 page renders ────────────────────────────
  if (!action || action === 'board') {
    const driveSnap = await db.collection('seasonDrives')
      .orderBy('openedAt', 'desc').limit(1).get().catch(() => ({ data: [] }))
    const drive = driveSnap.data[0] ?? null
    const season = drive?.season ?? ''

    const [renewalSnap, annualSnap] = await Promise.all([
      season
        ? db.collection('seasonRenewals').where({ season }).limit(300).get().catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      db.collection('users').where({ membershipType: 'annual' }).limit(300).get().catch(() => ({ data: [] })),
    ])

    const renewals = renewalSnap.data.map(r => ({
      ...r,
      id: r._id,
      respondedAt: toMs(r.respondedAt),
      decidedAt: toMs(r.decidedAt),
    }))
    const responded = new Set(renewals.map(r => r.uid))

    // Annual members who haven't said anything yet
    const awaiting = annualSnap.data
      .filter(u => !responded.has(u._id))
      .map(u => ({ uid: u._id, displayName: u.displayName, attendanceCount: u.attendanceCount ?? 0, annualSeason: u.annualSeason ?? '' }))

    // Who rollover would downgrade, if it ran right now
    const wouldDowngrade = annualSnap.data
      .filter(u => (u.annualSeason ?? '') !== season)
      .map(u => ({ uid: u._id, displayName: u.displayName }))

    return {
      currentSeason,
      drive: drive ? {
        ...drive,
        questions: drive.questions ?? [],
        openedAt: toMs(drive.openedAt),
        closedAt: toMs(drive.closedAt),
        rolledOverAt: toMs(drive.rolledOverAt),
      } : null,
      renewals,
      awaiting,
      wouldDowngrade,
    }
  }

  // ── open a drive for the coming season ────────────────────────────────────
  if (action === 'openDrive') {
    const season = (event.season || '').toString().trim()
    if (!SEASON_RE.test(season)) throw new Error('赛季名称格式不对（1-20 位字母/数字/汉字/短横）')
    const note = (event.note || '').toString().trim().slice(0, 200)
    const deadline = event.deadline ? Number(event.deadline) : null
    if (deadline !== null && (!Number.isFinite(deadline) || deadline < Date.now())) {
      throw new Error('截止时间必须晚于现在')
    }

    const existing = await db.collection('seasonDrives').doc(season).get().catch(() => ({ data: null }))
    if (existing.data?.rolledOverAt) throw new Error('该赛季已换季完成，不能重开登记')

    await db.collection('seasonDrives').doc(season).set({
      data: {
        season,
        status: 'open',
        deadline,
        note,
        questions: cleanQuestions(event.questions),
        openedAt: existing.data?.openedAt ?? db.serverDate(),
        closedAt: null,
        rolledOverAt: existing.data?.rolledOverAt ?? null,
      },
    })

    // Tell the people it applies to: current annual members
    const annualSnap = await db.collection('users').where({ membershipType: 'annual' }).limit(300).get().catch(() => ({ data: [] }))
    await notifyDriveOpen(season, { deadline }, annualSnap.data.map(u => u._id))

    return { success: true, season, notified: annualSnap.data.length }
  }

  // ── retune the questions while the drive is open ─────────────────────────
  // Already-submitted answers are left alone: dropping a question just stops
  // it being asked, and a new one is answered by whoever responds next.
  if (action === 'editQuestions') {
    const season = (event.season || '').toString().trim()
    if (!season) throw new Error('season required')
    const snap = await db.collection('seasonDrives').doc(season).get().catch(() => ({ data: null }))
    if (!snap.data) throw new Error('该赛季登记不存在')
    if (snap.data.rolledOverAt) throw new Error('该赛季已换季，不能再改问题')
    await db.collection('seasonDrives').doc(season).update({
      data: { questions: cleanQuestions(event.questions) },
    })
    return { success: true }
  }

  // ── close it (no more responses) ──────────────────────────────────────────
  if (action === 'closeDrive') {
    const season = (event.season || '').toString().trim()
    if (!season) throw new Error('season required')
    await db.collection('seasonDrives').doc(season).update({
      data: { status: 'closed', closedAt: db.serverDate() },
    })
    return { success: true }
  }

  // ── confirm / reject one player's response ───────────────────────────────
  if (action === 'decideRenewal') {
    const { renewalId, decision } = event
    if (!renewalId || !['confirmed', 'rejected'].includes(decision)) throw new Error('invalid params')

    const rSnap = await db.collection('seasonRenewals').doc(renewalId).get().catch(() => ({ data: null }))
    const renewal = rSnap.data
    if (!renewal) throw new Error('登记记录不存在')
    if (renewal.response !== 'continue') throw new Error('该球员选择的是暂不继续，无需确认')

    await db.collection('seasonRenewals').doc(renewalId).update({
      data: { status: decision, decidedBy: caller._id, decidedAt: db.serverDate() },
    })

    // Confirming is what actually grants the card, stamped with the drive's
    // season (not config.season — the drive runs before the rollover).
    if (decision === 'confirmed') {
      await db.collection('users').doc(renewal.uid).update({
        data: { membershipType: 'annual', annualSeason: renewal.season },
      }).catch(() => {})
      const uSnap = await db.collection('users').doc(renewal.uid).get().catch(() => ({ data: null }))
      if (uSnap.data?.openid) {
        await cloud.callFunction({
          name: 'sendSubscribeMsg',
          data: {
            type: 'matchOpen',
            toOpenid: uSnap.data.openid,
            data: {
              page: '/pages/profile/index',
              templateData: {
                thing4: { value: `${renewal.season} 赛季年卡已登记`.slice(0, 20) },
                thing2: { value: '年卡资格已延续,R1 优先报名' },
                date5: { value: new Date().toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16) },
              },
            },
          },
        }).catch(() => {})
      }
    }
    return { success: true }
  }

  // ── rollover: switch seasons and downgrade whoever didn't register ───────
  if (action === 'rollover') {
    const season = (event.season || '').toString().trim()
    if (!SEASON_RE.test(season)) throw new Error('season required')
    if (event.confirm !== true) throw new Error('rollover 需要 confirm: true')

    const annualSnap = await db.collection('users').where({ membershipType: 'annual' }).limit(300).get().catch(() => ({ data: [] }))
    const stale = annualSnap.data.filter(u => (u.annualSeason ?? '') !== season)

    // 次卡, not 未激活: they can still register and decide later, they just
    // lose R1 priority and the friend allowance.
    const downgraded = []
    for (const u of stale) {
      await db.collection('users').doc(u._id).update({
        data: { membershipType: 'per_session' },
      }).catch(() => {})
      downgraded.push({ uid: u._id, displayName: u.displayName })
    }

    await db.collection('config').doc('app').update({ data: { season } }).catch(() => {})
    await db.collection('seasonDrives').doc(season).update({
      data: { status: 'closed', rolledOverAt: db.serverDate() },
    }).catch(() => {})

    return { success: true, season, downgradedCount: downgraded.length, downgraded }
  }

  throw new Error('unknown action')
}
