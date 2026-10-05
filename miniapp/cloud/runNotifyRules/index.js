const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Scheduled / broadcast match notifications, driven by the notifyRules
// collection (managed on the admin 通知规则 page) instead of code. Each rule
// says when it fires, who gets it and what it says; notifyLog (ruleId_matchId)
// makes sure a rule fires at most once per match.
//
// Called every tick by confirmationTimeout, and right after an admin changes
// a match's phase (updateMatchStatus) so phase rules don't wait for the cron.
//
// Rule shape:
//   { name, enabled, text,
//     trigger: 'phase' | 'beforeKickoff' | 'matchDayAt',
//     phase?: 'registration_r1' | 'registration_r2' | 'drafting' | 'ready',
//     minutes?: number,           // beforeKickoff
//     time?: 'HH:mm',             // matchDayAt, America/New_York
//     audience: see AUDIENCES }

const ACTIVE = ['registration_r1', 'registration_r2', 'drafting', 'ready']

// A time rule that's this late (deploy, cron outage, rule created after the
// moment passed) is skipped for that match rather than sent stale.
const STALE_MS = 30 * 60000

const DEFAULT_RULES = [
  { name: 'R1 开放 → 年卡', enabled: true, trigger: 'phase', phase: 'registration_r1', audience: 'unregistered_annual', text: '新比赛开放报名(R1)' },
  { name: 'R2 开放 → 次卡', enabled: true, trigger: 'phase', phase: 'registration_r2', audience: 'unregistered_per_session', text: 'R2 全员报名已开放' },
  { name: '比赛当天中午提醒', enabled: true, trigger: 'matchDayAt', time: '12:00', audience: 'confirmed', text: '今天有球,别忘了你已报名' },
]

// Returns how many minutes ET is behind UTC (300 for EST, 240 for EDT — handles DST)
function etOffsetMinutes(date) {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const etStr  = date.toLocaleString('en-US', { timeZone: 'America/New_York' })
  return Math.round((new Date(utcStr) - new Date(etStr)) / 60000)
}

// HH:mm ET on the (ET) calendar day of kickoff
function matchDayTs(matchDate, hhmm) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(matchDate))
  const y = Number(parts.find(p => p.type === 'year').value)
  const mo = Number(parts.find(p => p.type === 'month').value)
  const da = Number(parts.find(p => p.type === 'day').value)
  const [h, mi] = String(hhmm || '12:00').split(':').map(Number)
  const utcBase = new Date(Date.UTC(y, mo - 1, da))
  return utcBase.getTime() + etOffsetMinutes(utcBase) * 60000 + ((h || 0) * 60 + (mi || 0)) * 60000
}

// Is this rule due for this match right now?
function isDue(rule, match, now) {
  if (rule.trigger === 'phase') return match.status === rule.phase
  let at
  if (rule.trigger === 'beforeKickoff') at = match.date - (Number(rule.minutes) || 0) * 60000
  else if (rule.trigger === 'matchDayAt') at = matchDayTs(match.date, rule.time)
  else return false
  return now >= at && now - at < STALE_MS && now < match.date
}

async function audienceOf(rule, matchId) {
  const regsSnap = await db.collection('registrations')
    .where({ matchId, status: _.in(['confirmed', 'promoted', 'waitlist']) })
    .limit(100).get().catch(() => ({ data: [] }))
  const regs = regsSnap.data.filter(r => !r.isGuest && r.uid)
  const onList = new Set(regs.map(r => r.uid))

  const usersByIds = async uids => uids.length
    ? (await db.collection('users').where({ _id: _.in(uids) }).limit(100).get().catch(() => ({ data: [] }))).data
    : []
  const unregistered = async types => (await db.collection('users')
    .where({ membershipType: _.in(types) }).limit(200).get().catch(() => ({ data: [] })))
    .data.filter(u => !onList.has(u._id))

  switch (rule.audience) {
    case 'confirmed': return usersByIds([...new Set(regs.filter(r => r.status === 'confirmed').map(r => r.uid))])
    case 'waitlist': return usersByIds([...new Set(regs.filter(r => r.status !== 'confirmed').map(r => r.uid))])
    case 'registered': return usersByIds([...onList])
    case 'unregistered_annual': return unregistered(['annual'])
    case 'unregistered_per_session': return unregistered(['per_session'])
    case 'unregistered_members': return unregistered(['annual', 'per_session'])
    default: return []
  }
}

async function send(rule, match, users) {
  const timeStr = new Date(match.date)
    .toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
  const targets = users.filter(u => u.openid)
  // 活动开始通知 (thing4/thing2/date5); best-effort, a dry quota just drops
  await Promise.all(targets.map(u => cloud.callFunction({
    name: 'sendSubscribeMsg',
    data: {
      type: 'matchOpen',
      toOpenid: u.openid,
      data: {
        page: `/pages/match-detail/index?id=${match._id}`,
        templateData: {
          thing4: { value: String(rule.text || '').slice(0, 20) },
          thing2: { value: (match.location || '待定').slice(0, 20) },
          date5: { value: timeStr },
        },
      },
    },
  }).catch(() => {})))
  return targets.length
}

// First run installs the rules that used to be hard-coded. Matches already
// past those moments are logged as done so the switch-over doesn't re-send.
async function seedDefaults(matches) {
  const cfg = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  if (!cfg.data || cfg.data.notifyRulesSeeded) return
  await db.collection('config').doc('app').update({ data: { notifyRulesSeeded: true } })
  for (const r of DEFAULT_RULES) {
    const added = await db.collection('notifyRules').add({ data: { ...r, createdAt: Date.now() } })
    for (const m of matches) {
      if (isDue(r, m, Date.now())) {
        await db.collection('notifyLog').doc(added._id + '_' + m._id)
          .set({ data: { ruleId: added._id, matchId: m._id, sent: 0, seeded: true, at: Date.now() } }).catch(() => {})
      }
    }
  }
}

exports.main = async (event) => {
  const source = String(cloud.getWXContext().SOURCE || '').split(',').pop()
  if (source === 'wx_client' || source === 'wx_devtools' || source === 'wx_unknown') {
    throw new Error('internal calls only')
  }

  const now = Date.now()
  const matchSnap = event.matchId
    ? await db.collection('matches').where({ _id: event.matchId }).get().catch(() => ({ data: [] }))
    : await db.collection('matches').where({ status: _.in(ACTIVE), date: _.gt(now) }).get().catch(() => ({ data: [] }))
  const matches = matchSnap.data.filter(m => ACTIVE.includes(m.status) && m.date > now)

  await seedDefaults(matches)

  const rulesSnap = await db.collection('notifyRules').where({ enabled: true }).limit(100).get().catch(() => ({ data: [] }))
  let sent = 0
  for (const m of matches) {
    for (const rule of rulesSnap.data) {
      if (!isDue(rule, m, now)) continue
      const logId = rule._id + '_' + m._id
      const done = await db.collection('notifyLog').doc(logId).get().then(() => true).catch(() => false)
      if (done) continue
      // Claim before sending so an overlapping run can't double-send
      await db.collection('notifyLog').doc(logId)
        .set({ data: { ruleId: rule._id, matchId: m._id, sent: 0, at: now } })
      const n = await send(rule, m, await audienceOf(rule, m._id))
      await db.collection('notifyLog').doc(logId).update({ data: { sent: n } }).catch(() => {})
      sent += n
    }
  }
  return { sent }
}
