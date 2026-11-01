const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 通知规则 CRUD for the admin page. The rules themselves are executed by
// runNotifyRules; see there for the shape.
const TRIGGERS = ['phase', 'beforeKickoff', 'matchDayAt']
const PHASES = ['registration_r1', 'registration_r2', 'drafting', 'ready']
const AUDIENCES = ['confirmed', 'waitlist', 'registered', 'unregistered_annual', 'unregistered_per_session', 'unregistered_members']

function clean(rule) {
  const name = String(rule.name || '').trim().slice(0, 30)
  const text = String(rule.text || '').trim()
  if (!name) throw new Error('请填写规则名称')
  if (!text) throw new Error('请填写通知文案')
  if (text.length > 20) throw new Error('通知文案最多 20 个字（微信模板限制）')
  if (!TRIGGERS.includes(rule.trigger)) throw new Error('未知的触发方式')
  if (!AUDIENCES.includes(rule.audience)) throw new Error('未知的发送对象')

  const out = { name, text, trigger: rule.trigger, audience: rule.audience, enabled: rule.enabled !== false }
  if (rule.trigger === 'phase') {
    if (!PHASES.includes(rule.phase)) throw new Error('请选择比赛阶段')
    out.phase = rule.phase
  } else if (rule.trigger === 'beforeKickoff') {
    const minutes = Math.round(Number(rule.minutes))
    if (!(minutes > 0 && minutes <= 7 * 24 * 60)) throw new Error('开球前分钟数需在 1 分钟到 7 天之间')
    out.minutes = minutes
  } else {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(rule.time))) throw new Error('请选择时间')
    out.time = rule.time
  }
  return out
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const { action } = event

  if (action === 'list') {
    const rulesSnap = await db.collection('notifyRules').limit(100).get().catch(() => ({ data: [] }))
    const ids = rulesSnap.data.map(r => r._id)
    // Most recent send per rule, so admins can see it actually went out
    const logs = ids.length
      ? await db.collection('notifyLog').where({ ruleId: _.in(ids) })
          .orderBy('at', 'desc').limit(500).get().catch(() => ({ data: [] }))
      : { data: [] }
    const last = {}
    for (const l of logs.data) if (!last[l.ruleId] && !l.seeded) last[l.ruleId] = { at: l.at, sent: l.sent ?? 0 }
    const rules = rulesSnap.data
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .map(r => ({ ...r, id: r._id, lastSent: last[r._id] ?? null }))
    return { rules }
  }

  if (action === 'save') {
    const data = { ...clean(event.rule || {}), updatedAt: Date.now() }
    if (event.id) {
      await db.collection('notifyRules').doc(event.id).update({ data })
      return { success: true, id: event.id }
    }
    const res = await db.collection('notifyRules').add({ data: { ...data, createdAt: Date.now() } })
    return { success: true, id: res._id }
  }

  if (action === 'toggle') {
    if (!event.id) throw new Error('id required')
    await db.collection('notifyRules').doc(event.id).update({ data: { enabled: !!event.enabled, updatedAt: Date.now() } })
    return { success: true }
  }

  if (action === 'delete') {
    if (!event.id) throw new Error('id required')
    await db.collection('notifyRules').doc(event.id).remove()
    await db.collection('notifyLog').where({ ruleId: event.id }).remove().catch(() => {})
    return { success: true }
  }

  throw new Error('unknown action')
}
