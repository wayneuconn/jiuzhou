const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { buildXlsx } = require('./xlsx')

const SCOPE_TYPES = { annual: ['annual'], member: ['annual', 'per_session'], all: null }
const SCOPE_LABEL = { annual: '仅限年卡', member: '年卡+次卡', all: '所有人' }
const STATUS_LABEL = { polled: '仅投票', confirmed: '已报名', withdrawn: '已取消' }
const TYPE_LABEL = { annual: '年卡', per_session: '次卡', none: '无' }

const etTime = (v) => {
  const d = v instanceof Date ? v : typeof v === 'number' ? new Date(v) : null
  if (!d || isNaN(d.getTime())) return ''
  return d.toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
}

const answerText = (a) => Array.isArray(a) ? a.join('、') : (a ?? '')

function answerSheet(title, questions, regs, field) {
  const header = ['序号', '姓名', '状态', '家属人数', '家属称呼', '提交时间', ...questions.map(q => q.title)]
  const rows = regs.map((r, i) => [
    i + 1,
    r.displayName || '',
    STATUS_LABEL[r.status] || r.status || '',
    r.guests || 0,
    r.guestNames || '',
    etTime(r.registeredAt),
    ...questions.map(q => answerText((r[field] || {})[q.id])),
  ])
  return { name: title, rows: [header, ...rows] }
}

function tallySheet(ev, regs, confirmed) {
  const rows = [['阶段', '问题', '选项', '人数', '谁选的']]
  const add = (phase, questions, pool, field) => {
    for (const q of questions || []) {
      if (q.type === 'text') continue
      for (const opt of q.options) {
        const who = pool.filter(r => {
          const a = (r[field] || {})[q.id]
          return Array.isArray(a) ? a.includes(opt) : a === opt
        })
        rows.push([phase, q.title, opt, who.length, who.map(r => r.displayName).join('、')])
      }
    }
  }
  add('投票', ev.pollQuestions, regs, 'pollAnswers')
  add('报名', ev.signupQuestions, confirmed, 'signupAnswers')
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
  const confirmed = regs.filter(r => r.status === 'confirmed')
  const polled = regs.filter(r => Object.keys(r.pollAnswers || {}).length > 0)

  const sheets = [{
    name: '概况',
    rows: [
      ['项目', '内容'],
      ['活动', ev.title || ''],
      ['时间', ev.eventDate ? etTime(ev.eventDate) : '待定'],
      ['地点', ev.location || ''],
      ['范围', SCOPE_LABEL[ev.scope] || ev.scope || ''],
      ['报名截止', ev.deadline ? etTime(ev.deadline) : '无'],
      ['已报名', confirmed.length],
      ['总人数（含家属）', confirmed.reduce((s, r) => s + 1 + (r.guests || 0), 0)],
      ['已投票', polled.length],
      ['导出时间', etTime(new Date())],
    ],
  }]

  sheets.push(answerSheet('报名名单', ev.signupQuestions || [], confirmed, 'signupAnswers'))
  if ((ev.pollQuestions || []).length) {
    sheets.push(answerSheet('投票', ev.pollQuestions, polled, 'pollAnswers'))
  }
  sheets.push(tallySheet(ev, regs, confirmed))

  const responded = new Set(regs.filter(r => r.status !== 'withdrawn').map(r => r.uid))
  const quiet = scopeSnap.data.filter(u => !responded.has(u._id))
  sheets.push({
    name: '未响应',
    rows: [['姓名', '会员类型'], ...quiet.map(u => [u.displayName || '', TYPE_LABEL[u.membershipType] || u.membershipType || ''])],
  })

  const buf = buildXlsx(sheets)
  const stamp = etTime(new Date()).replace(/[ :]/g, '-')
  const safeTitle = (ev.title || '活动').replace(/[\\/:*?"<>|]/g, '').slice(0, 20)
  const up = await cloud.uploadFile({
    cloudPath: `exports/events/${eventId}_${Date.now()}.xlsx`,
    fileContent: buf,
  })
  return { fileID: up.fileID, fileName: `${safeTitle}_${stamp}.xlsx` }
}
