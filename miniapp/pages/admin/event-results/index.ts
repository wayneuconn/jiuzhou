import type { TeamEvent, EventQuestion, EventReg } from '../../../types/index'
import { formatDate } from '../../../utils/format'

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', polling: '征集意见中', registration: '报名中', closed: '已截止', cancelled: '已取消',
}

interface OptResult { label: string; count: number; pct: number; names: string }
interface QuestionResult {
  id: string
  title: string
  type: string
  opts: OptResult[]
  textItems: Array<{ name: string; answer: string }>
  answered: number
}

function buildResults(questions: EventQuestion[], regs: EventReg[], field: 'pollAnswers' | 'signupAnswers'): QuestionResult[] {
  return (questions || []).map(q => {
    const picked = (r: EventReg) => (r[field] || {})[q.id]
    const answered = regs.filter(r => {
      const a = picked(r)
      return Array.isArray(a) ? a.length > 0 : (typeof a === 'string' && a !== '')
    })
    if (q.type === 'text') {
      return {
        id: q.id, title: q.title, type: q.type, opts: [],
        answered: answered.length,
        textItems: answered.map(r => ({ name: r.displayName, answer: String(picked(r)) })),
      }
    }
    const opts = q.options.map(opt => {
      const voters = regs.filter(r => {
        const a = picked(r)
        return Array.isArray(a) ? a.includes(opt) : a === opt
      })
      return {
        label: opt,
        count: voters.length,
        pct: answered.length ? Math.round((voters.length / answered.length) * 100) : 0,
        names: voters.map(v => v.displayName).join('、'),
      }
    })
    return { id: q.id, title: q.title, type: q.type, opts, textItems: [], answered: answered.length }
  })
}

Page({
  data: {
    eventId: '',
    title: '',
    statusLabel: '',
    eventDateStr: '',
    polledCount: 0,
    confirmedCount: 0,
    headcount: 0,
    pollResults: [] as QuestionResult[],
    signupResults: [] as QuestionResult[],
    attendees: [] as Array<{ displayName: string; guests: number; guestNames: string }>,
    polledNotSigned: '',
    notResponded: '',
    notRespondedCount: 0,
    showChase: false,
    loading: true,
    loadError: false,
  },

  _poll: null as ReturnType<typeof setInterval> | null,
  _sig: '',

  onLoad(options: Record<string, string>) {
    this.setData({ eventId: options.id || '' })
    this.load()
    this._poll = setInterval(() => this.load(true), 5000)
  },
  onHide() { this._stop() },
  onUnload() { this._stop() },
  onShow() {
    if (this.data.eventId && !this._poll) {
      this._poll = setInterval(() => this.load(true), 5000)
      this.load(true)
    }
  },
  onPullDownRefresh() { this.load(true).finally(() => wx.stopPullDownRefresh()) },
  _stop() { if (this._poll) { clearInterval(this._poll); this._poll = null } },

  async load(silent = false) {
    if (!this.data.eventId) return
    if (!silent) this.setData({ loading: true, loadError: false })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getEventResults',
        data: { eventId: this.data.eventId },
      }) as unknown as {
        result: {
          event: TeamEvent
          regs: EventReg[]
          scopeUsers: Array<{ _id: string; displayName: string }>
        }
      }
      const { event: ev, regs, scopeUsers } = res.result

      const sig = JSON.stringify(regs.map(r => [r.uid, r.status, r.guests, r.pollAnswers, r.signupAnswers]))
      if (silent && sig === this._sig) return
      this._sig = sig

      const polled = regs.filter(r => Object.keys(r.pollAnswers || {}).length > 0)
      const confirmed = regs.filter(r => r.status === 'confirmed')
      const headcount = confirmed.reduce((s, r) => s + 1 + (r.guests || 0), 0)
      const respondedUids = new Set(regs.filter(r => r.status !== 'withdrawn' || Object.keys(r.pollAnswers || {}).length > 0).map(r => r.uid))
      const confirmedUids = new Set(confirmed.map(r => r.uid))
      const notRespondedList = scopeUsers.filter(u => !respondedUids.has(u._id)).map(u => u.displayName)

      this.setData({
        title: ev.title,
        statusLabel: STATUS_LABEL[ev.status] ?? ev.status,
        eventDateStr: ev.eventDate ? formatDate(ev.eventDate) : '时间待定',
        polledCount: polled.length,
        confirmedCount: confirmed.length,
        headcount,
        pollResults: buildResults(ev.pollQuestions || [], regs, 'pollAnswers'),
        signupResults: buildResults(ev.signupQuestions || [], confirmed, 'signupAnswers'),
        attendees: confirmed.map(r => ({ displayName: r.displayName, guests: r.guests || 0, guestNames: r.guestNames || '' })),
        polledNotSigned: polled.filter(r => !confirmedUids.has(r.uid)).map(r => r.displayName).join('、'),
        notResponded: notRespondedList.join('、'),
        notRespondedCount: notRespondedList.length,
        showChase: ev.status === 'registration' || ev.status === 'polling',
      })
    } catch (err) {
      console.error('load results failed', err)
      if (!silent) this.setData({ loadError: true })
    } finally {
      if (!silent) this.setData({ loading: false })
    }
  },
  retryLoad() { this.load() },
})
