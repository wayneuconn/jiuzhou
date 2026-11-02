import type { TeamEvent, EventQuestion, EventReg } from '../../../types/index'
import { formatDate } from '../../../utils/format'

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', prep: '第一轮', open: '进行中', closed: '已结束', cancelled: '已取消',
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

function buildResults(questions: EventQuestion[], regs: EventReg[], field: 'prepAnswers' | 'answers'): QuestionResult[] {
  return (questions || []).map(q => {
    const picked = (r: EventReg) => (r[field] || {})[q.id]
    const answered = regs.filter(r => {
      const a = picked(r)
      return Array.isArray(a) ? a.length > 0 : (typeof a === 'number' ? true : typeof a === 'string' && a !== '')
    })
    if (q.type === 'text' || q.type === 'number') {
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
    actionLabel: '提交',
    preppedCount: 0,
    submittedCount: 0,
    headcount: 0,
    prepResults: [] as QuestionResult[],
    mainResults: [] as QuestionResult[],
    roster: [] as Array<{ displayName: string; seats: number }>,
    preppedNotSubmitted: '',
    notResponded: '',
    notRespondedCount: 0,
    showChase: false,
    loading: true,
    loadError: false,
    exporting: false,
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

      const sig = JSON.stringify(regs.map(r => [r.uid, r.status, r.prepAnswers, r.answers]))
      if (silent && sig === this._sig) return
      this._sig = sig

      const seatsOf = (r: EventReg) => (ev.questions || []).reduce(
        (n, q) => q.type === 'number' && q.countsSeats ? n + (Number((r.answers || {})[q.id]) || 0) : n, 0)

      const prepped = regs.filter(r => Object.keys(r.prepAnswers || {}).length > 0)
      const submitted = regs.filter(r => r.status === 'submitted')
      const headcount = submitted.reduce((s, r) => s + 1 + seatsOf(r), 0)
      const respondedUids = new Set(regs.filter(r => r.status !== 'withdrawn' || Object.keys(r.prepAnswers || {}).length > 0).map(r => r.uid))
      const submittedUids = new Set(submitted.map(r => r.uid))
      const notRespondedList = scopeUsers.filter(u => !respondedUids.has(u._id)).map(u => u.displayName)

      this.setData({
        title: ev.title,
        statusLabel: STATUS_LABEL[ev.status] ?? ev.status,
        eventDateStr: ev.eventDate ? formatDate(ev.eventDate) : '时间待定',
        actionLabel: ev.actionLabel || '提交',
        preppedCount: prepped.length,
        submittedCount: submitted.length,
        headcount,
        prepResults: buildResults(ev.prepQuestions || [], regs, 'prepAnswers'),
        mainResults: buildResults(ev.questions || [], submitted, 'answers'),
        roster: submitted.map(r => ({ displayName: r.displayName, seats: seatsOf(r) })),
        preppedNotSubmitted: prepped.filter(r => !submittedUids.has(r.uid)).map(r => r.displayName).join('、'),
        notResponded: notRespondedList.join('、'),
        notRespondedCount: notRespondedList.length,
        showChase: ev.status === 'open' || ev.status === 'prep',
      })
    } catch (err) {
      console.error('load results failed', err)
      if (!silent) this.setData({ loadError: true })
    } finally {
      if (!silent) this.setData({ loading: false })
    }
  },
  retryLoad() { this.load() },

  async exportXlsx() {
    if (this.data.exporting) return
    this.setData({ exporting: true })
    wx.showLoading({ title: '生成表格...', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'exportEventResults',
        data: { eventId: this.data.eventId },
      }) as unknown as { result: { fileID: string; fileName: string } }
      const { tempFilePath } = await wx.cloud.downloadFile({ fileID: res.result.fileID })
      wx.hideLoading()
      await wx.openDocument({ filePath: tempFilePath, fileType: 'xlsx', showMenu: true })
    } catch (err) {
      wx.hideLoading()
      console.error('export failed', err)
      wx.showModal({ title: '导出失败', content: '请重试，或检查网络', showCancel: false })
    } finally {
      this.setData({ exporting: false })
    }
  },
})
