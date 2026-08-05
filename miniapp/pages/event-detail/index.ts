import type { TeamEvent, EventQuestion, EventReg } from '../../types/index'
import { formatDate, markdownToHtml } from '../../utils/format'

function errText(err: unknown, fallback: string): string {
  const raw = (err as { errMsg?: string; message?: string })?.errMsg
    || (err as Error)?.message || ''
  const m = raw.match(/errMsg:\s*Error:\s*([^]+?)(?:\s+at\s|$)/)
  const text = (m ? m[1] : raw).trim()
  return text && text.length <= 60 ? text : fallback
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  polling: '征集意见中',
  registration: '报名中',
  closed: '已截止',
  cancelled: '已取消',
}

interface OptVM { label: string; count: number; selected: boolean }
interface QuestionVM {
  id: string
  title: string
  type: string
  required: boolean
  opts: OptVM[]
  textValue: string
}

type Answers = Record<string, string | string[]>

interface Tally { id: string; counts: Array<{ option: string; count: number }> }

function buildVM(questions: EventQuestion[], sel: Answers, tallies: Tally[], showCounts: boolean): QuestionVM[] {
  return (questions || []).map(q => {
    const t = tallies.find(x => x.id === q.id)
    const a = sel[q.id]
    return {
      id: q.id,
      title: q.title,
      type: q.type,
      required: q.required,
      textValue: q.type === 'text' && typeof a === 'string' ? a : '',
      opts: q.options.map(opt => ({
        label: opt,
        count: showCounts ? (t?.counts.find(c => c.option === opt)?.count ?? 0) : -1,
        selected: Array.isArray(a) ? a.includes(opt) : a === opt,
      })),
    }
  })
}

Page({
  data: {
    eventId: '',
    event: null as TeamEvent | null,
    statusLabel: '',
    descriptionHtml: '',
    eventDateStr: '',
    deadlineStr: '',
    scopeLabel: '',
    pollVM: [] as QuestionVM[],
    signupVM: [] as QuestionVM[],
    attendees: [] as Array<{ uid: string; displayName: string; guests: number; guestNames: string }>,
    headcount: 0,
    pollCount: 0,
    myStatus: '' as '' | 'polled' | 'confirmed' | 'withdrawn',
    guests: 0,
    guestNames: '',
    inScope: true,
    isAdmin: false,
    textAnswers: null as Record<string, Array<{ name: string; answer: string }>> | null,
    textAnswerList: [] as Array<{ title: string; items: Array<{ name: string; answer: string }> }>,
    loading: true,
    loadError: false,
    busy: false,
    isEntry: false,
  },

  _pollSel: {} as Answers,
  _signupSel: {} as Answers,
  _event: null as TeamEvent | null,

  onLoad(options: Record<string, string>) {
    this.setData({ eventId: options.id || '', isEntry: getCurrentPages().length === 1 })
    this.loadEvent()
  },
  onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    if (this.data.eventId) this.loadEvent()
  },
  onPullDownRefresh() { this.loadEvent().finally(() => wx.stopPullDownRefresh()) },
  goHome() { wx.switchTab({ url: '/pages/home/index' }) },
  noop() {},

  async loadEvent() {
    if (!this.data.eventId) return
    this.setData({ loading: true, loadError: false })
    try {
      const app = getApp<{ loginReady?: Promise<void>; globalData: { userProfile: { role?: string; membershipType?: string } | null } }>()
      await (app.loginReady ?? Promise.resolve()).catch(() => {})
      const res = await wx.cloud.callFunction({
        name: 'getEventDetail',
        data: { eventId: this.data.eventId },
      }) as unknown as {
        result: {
          event: TeamEvent
          myReg: EventReg | null
          attendees: Array<{ uid: string; displayName: string; guests: number; guestNames: string }>
          headcount: number
          pollCount: number
          pollTally: Tally[]
          signupTally: Tally[]
          textAnswers: Record<string, Array<{ name: string; answer: string }>> | null
          callerInfo: { membershipType: string; role: string } | null
        }
      }
      const { event: ev, myReg, attendees, headcount, pollCount, pollTally, signupTally, textAnswers, callerInfo } = res.result
      this._event = ev
      const isAdmin = callerInfo?.role === 'admin'

      // Prefill local selections from my previous answers
      this._pollSel = { ...(myReg?.pollAnswers ?? {}) }
      this._signupSel = { ...(myReg?.signupAnswers ?? {}) }

      const mt = callerInfo?.membershipType ?? 'none'
      const inScope = isAdmin
        || (ev.scope === 'all')
        || (ev.scope === 'member' && ['annual', 'per_session'].includes(mt))
        || (ev.scope === 'annual' && mt === 'annual')

      // Text answers → renderable list (admin only)
      const textAnswerList: Array<{ title: string; items: Array<{ name: string; answer: string }> }> = []
      if (textAnswers) {
        for (const q of [...(ev.pollQuestions || []), ...(ev.signupQuestions || [])]) {
          if (q.type === 'text' && textAnswers[q.id]?.length) {
            textAnswerList.push({ title: q.title, items: textAnswers[q.id] })
          }
        }
      }

      this.setData({
        event: ev,
        statusLabel: STATUS_LABEL[ev.status] ?? ev.status,
        descriptionHtml: markdownToHtml(ev.description || ''),
        eventDateStr: ev.eventDate ? formatDate(ev.eventDate) : '时间待定',
        deadlineStr: ev.deadline ? formatDate(ev.deadline) : '',
        scopeLabel: ev.scope === 'annual' ? '仅限年卡' : ev.scope === 'member' ? '年卡+次卡' : '所有人',
        pollVM: buildVM(ev.pollQuestions || [], this._pollSel, pollTally, true),
        signupVM: buildVM(ev.signupQuestions || [], this._signupSel, signupTally, ev.status === 'closed' || isAdmin),
        attendees,
        headcount,
        pollCount,
        myStatus: (myReg?.status as '' | 'polled' | 'confirmed' | 'withdrawn') ?? '',
        guests: myReg?.guests ?? 0,
        guestNames: myReg?.guestNames ?? '',
        inScope,
        isAdmin,
        textAnswerList,
      })
    } catch (err) {
      console.error('loadEvent failed', err)
      this.setData({ loadError: true })
    } finally {
      this.setData({ loading: false })
    }
  },
  retryLoad() { this.loadEvent() },

  // ── answer pickers (shared by poll/signup via data-phase) ────────────────
  pickOption(e: WechatMiniprogram.BaseEvent) {
    const { phase, qid, opt, qtype } = e.currentTarget.dataset as { phase: 'poll' | 'signup'; qid: string; opt: string; qtype: string }
    const sel = phase === 'poll' ? this._pollSel : this._signupSel
    if (qtype === 'multi') {
      const cur = Array.isArray(sel[qid]) ? [...(sel[qid] as string[])] : []
      const i = cur.indexOf(opt)
      if (i >= 0) cur.splice(i, 1)
      else cur.push(opt)
      sel[qid] = cur
    } else {
      sel[qid] = sel[qid] === opt ? '' : opt
    }
    this._rerenderQuestions(phase)
  },

  onAnswerText(e: WechatMiniprogram.Input) {
    const { phase, qid } = e.currentTarget.dataset as { phase: 'poll' | 'signup'; qid: string }
    const sel = phase === 'poll' ? this._pollSel : this._signupSel
    sel[qid] = e.detail.value
  },

  _rerenderQuestions(phase: 'poll' | 'signup') {
    const ev = this._event
    if (!ev) return
    if (phase === 'poll') {
      this.setData({ pollVM: buildVM(ev.pollQuestions || [], this._pollSel, [], false).map((q, i) => ({ ...q, opts: q.opts.map((o, j) => ({ ...o, count: this.data.pollVM[i]?.opts[j]?.count ?? -1 })) })) })
    } else {
      this.setData({ signupVM: buildVM(ev.signupQuestions || [], this._signupSel, [], false).map((q, i) => ({ ...q, opts: q.opts.map((o, j) => ({ ...o, count: this.data.signupVM[i]?.opts[j]?.count ?? -1 })) })) })
    }
  },

  async submitPoll() {
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'joinEvent',
        data: { eventId: this.data.eventId, mode: 'poll', pollAnswers: this._pollSel },
      })
      wx.showToast({ title: '已提交投票', icon: 'success' })
      this.loadEvent()
    } catch (err: unknown) {
      wx.showModal({ title: '提交失败', content: errText(err, '提交失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  incGuests(e: WechatMiniprogram.BaseEvent) {
    const delta = Number((e.currentTarget.dataset as { delta: number }).delta)
    const max = this._event?.maxGuestsPer ?? 0
    const next = Math.max(0, Math.min(max, this.data.guests + delta))
    this.setData({ guests: next })
  },
  onGuestNames(e: WechatMiniprogram.Input) { this.setData({ guestNames: e.detail.value }) },

  async submitSignup() {
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'joinEvent',
        data: {
          eventId: this.data.eventId,
          mode: 'signup',
          guests: this.data.guests,
          guestNames: this.data.guestNames.trim(),
          signupAnswers: this._signupSel,
        },
      })
      wx.showToast({ title: this.data.myStatus === 'confirmed' ? '已更新' : '报名成功', icon: 'success' })
      this.loadEvent()
    } catch (err: unknown) {
      wx.showModal({ title: '报名失败', content: errText(err, '报名失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async withdrawEvent() {
    const res = await wx.showModal({ title: '取消报名？', content: '', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'joinEvent',
        data: { eventId: this.data.eventId, mode: 'withdraw' },
      })
      wx.showToast({ title: '已取消', icon: 'success' })
      this.loadEvent()
    } catch (err: unknown) {
      wx.showModal({ title: '操作失败', content: errText(err, '操作失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  // ── admin phase controls ─────────────────────────────────────────────────
  async setEvStatus(e: WechatMiniprogram.BaseEvent) {
    const { status, label } = e.currentTarget.dataset as { status: string; label: string }
    const res = await wx.showModal({ title: `确认「${label}」？`, content: '', confirmColor: '#00C9A7' })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'adminSaveEvent',
        data: { action: 'setStatus', eventId: this.data.eventId, status },
      })
      wx.showToast({ title: '已更新', icon: 'success' })
      this.loadEvent()
    } catch (err: unknown) {
      wx.showModal({ title: '操作失败', content: errText(err, '操作失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  onShareAppMessage() {
    return {
      title: this._event ? `${this._event.title} — 九州球队活动` : '九州球队活动',
      path: `/pages/event-detail/index?id=${this.data.eventId}`,
    }
  },
})
