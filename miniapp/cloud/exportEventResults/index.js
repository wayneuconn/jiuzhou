const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { buildXlsx } = require('./xlsx')

const SCOPE_TYPES = { annual: ['annual'], member: ['annual', 'per_session'], all: null }
const SCOPE_LABEL = { annual: '仅限年卡', member: '年卡+次卡', all: '所有人' }
const STATUS_LABEL = { prepped: '只答了第一轮', submitted: '已提交', withdrawn: '已撤回' }
const TYPE_LABEL = { annual: '年卡', per_session: '次卡', none: '无' }

const etTime = (v) => {
  const d = v instanceof Date ? v : typeof v === 'number' ? new Date(v) : null
  if (!d || isNaN(d.getTime())) return ''
  return d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
}

const answerText = (a) => Array.isArray(a) ? a.join('、') : (a ?? '')

const seatsOf = (questions, answers) => (questions || []).reduce(
  (n, q) => q.type === 'number' && q.countsSeats ? n + (Number((answers || {})[q.id]) || 0) : n, 0)

function answerSheet(title, questions, regs, field) {
  const header = ['序号', '姓名', '状态', '提交时间', ...questions.map(q => q.title)]
  const rows = regs.map((r, i) => [
    i + 1,
    r.displayName || '',
    STATUS_LABEL[r.status] || r.status || '',
    etTime(r.registeredAt),
    ...questions.map(q => answerText((r[field] || {})[q.id])),
  ])
  return { name: title, rows: [header, ...rows] }
}

function tallySheet(ev, regs, submitted) {
  const rows = [['轮次', '问题', '选项', '人数', '谁选的']]
  const add = (round, questions, pool, field) => {
    for (const q of questions || []) {
      if (q.type === 'text') continue
      if (q.type === 'number') {
        const answered = pool.filter(r => Number.isFinite(Number((r[field] || {})[q.id])))
        const total = answered.reduce((s, r) => s + Number((r[field] || {})[q.id]), 0)
        rows.push([round, q.title, '合计', total, answered.map(r => `${r.displayName}×${(r[field] || {})[q.id]}`).join('、')])
        continue
      }
      for (const opt of q.options) {
        const who = pool.filter(r => {
          const a = (r[field] || {})[q.id]
          return Array.isArray(a) ? a.includes(opt) : a === opt
        })
        rows.push([round, q.title, opt, who.length, who.map(r => r.displayName).join('、')])
      }
    }
  }
  add('第一轮', ev.prepQuestions, regs, 'prepAnswers')
  add('正式', ev.questions, submitted, 'answers')
  return { name: '统计', rows }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = userSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const { eventId } = event
  const evSnap = await db.collection('events').doc(eventId).get().catch(() => ({ data: null }))
  const ev = evSnap.data
  if (!ev) throw new Error('event not found')

  const types = SCOPE_TYPES[ev.scope] ?? ['annual']
  const [regsSnap, scopeSnap] = await Promise.all([
    db.collection('eventRegistrations').where({ eventId }).limit(300).get().catch(() => ({ data: [] })),
    db.collection('users').where(types ? { membershipType: _.in(types) } : {})
      .field({ _id: true, displayName: true, membershipType: true })
      .limit(300).get().catch(() => ({ data: [] })),
  ])

  const byTime = (a, b) => new Date(a.registeredAt || 0) - new Date(b.registeredAt || 0)
  const regs = regsSnap.data.slice().sort(byTime)
  const submitted = regs.filter(r => r.status === 'submitted')
  const prepped = regs.filter(r => Object.keys(r.prepAnswers || {}).length > 0)

  const sheets = [{
    name: '概况',
    rows: [
      ['项目', '内容'],
      ['标题', ev.title || ''],
      ['时间', ev.eventDate ? etTime(ev.eventDate) : '待定'],
      ['地点', ev.location || ''],
      ['范围', SCOPE_LABEL[ev.scope] || ev.scope || ''],
      ['截止', ev.deadline ? etTime(ev.deadline) : '无'],
      [`已${ev.actionLabel || '提交'}`, submitted.length],
      ['总人数（含附加名额）', submitted.reduce((s, r) => s + 1 + seatsOf(ev.questions, r.answers), 0)],
      ['第一轮参与', prepped.length],
      ['导出时间', etTime(new Date())],
    ],
  }]

  sheets.push(answerSheet('名单', ev.questions || [], submitted, 'answers'))
  if ((ev.prepQuestions || []).length) {
    sheets.push(answerSheet('第一轮', ev.prepQuestions, prepped, 'prepAnswers'))
  }
  sheets.push(tallySheet(ev, regs, submitted))

  const responded = new Set(regs.filter(r => r.status !== 'withdrawn').map(r => r.uid))
  const quiet = scopeSnap.data.filter(u => !responded.has(u._id))
  sheets.push({
    name: '未响应',
    rows: [['姓名', '会员类型'], ...quiet.map(u => [u.displayName || '', TYPE_LABEL[u.membershipType] || u.membershipType || ''])],
  })

  const buf = buildXlsx(sheets)
  const stamp = etTime(new Date()).replace(/[ :]/g, '-')
  const safeTitle = (ev.title || '表单').replace(/[\\/:*?"<>|]/g, '').slice(0, 20)
  const up = await cloud.uploadFile({
    cloudPath: `exports/events/${eventId}_${Date.now()}.xlsx`,
    fileContent: buf,
  })
  return { fileID: up.fileID, fileName: `${safeTitle}_${stamp}.xlsx` }
}
