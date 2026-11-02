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
  prep: '第一轮进行中',
  open: '进行中',
  closed: '已结束',
  cancelled: '已取消',
}

interface OptVM { label: string; count: number; selected: boolean; takenBy: string; locked: boolean }
interface QuestionVM {
  id: string
  title: string
  type: string
  required: boolean
  exclusive: boolean
  max: number
  opts: OptVM[]
  textValue: string
  numValue: number
}

type Answers = Record<string, string | string[] | number>

interface Tally { id: string; counts: Array<{ option: string; count: number }> }
type TakenMap = Record<string, Record<string, { name: string; mine: boolean }>>

function buildVM(questions: EventQuestion[], sel: Answers, tallies: Tally[], showCounts: boolean, taken: TakenMap): QuestionVM[] {
  return (questions || []).map(q => {
    const t = tallies.find(x => x.id === q.id)
    const held = taken[q.id] ?? {}
    const a = sel[q.id]
    return {
      id: q.id,
      title: q.title,
      type: q.type,
      required: q.required,
      exclusive: q.exclusive === true,
      max: q.max ?? 1,
      textValue: q.type === 'text' && typeof a === 'string' ? a : '',
      numValue: q.type === 'number' ? (Number(a) || 0) : 0,
      opts: (q.options || []).map(opt => {
        const by = held[opt]
        return {
          label: opt,
          // An exclusive option says who holds it instead of a headcount
          count: q.exclusive || !showCounts ? -1 : (t?.counts.find(c => c.option === opt)?.count ?? 0),
          selected: Array.isArray(a) ? a.includes(opt) : a === opt,
          takenBy: by ? (by.mine ? '我' : by.name) : '',
          locked: !!by && !by.mine,
        }
      }),
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
    actionLabel: '提交',
    hasPrep: false,
    prepVM: [] as QuestionVM[],
    mainVM: [] as QuestionVM[],
    roster: [] as Array<{ uid: string; displayName: string; seats: number }>,
    showRoster: false,
    showCount: false,
    submittedCount: 0,
    headcount: 0,
    prepCount: 0,
    myStatus: '' as '' | 'prepped' | 'submitted' | 'withdrawn',
    inScope: true,
    isAdmin: false,
    loading: true,
    loadError: false,
    blocked: false,
    blockedLabel: '',
    busy: false,
    isEntry: false,
  },

  _prepSel: {} as Answers,
  _mainSel: {} as Answers,
  _taken: {} as TakenMap,
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
    this.setData({ loading: true, loadError: false, blocked: false })
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
          roster: Array<{ uid: string; displayName: string; seats: number }>
          submittedCount: number | null
          headcount: number | null
          prepCount: number
          prepTally: Tally[]
          tally: Tally[]
          exclusiveTaken: TakenMap
          callerInfo: { membershipType: string; role: string } | null
        }
      }
      const maybeBlocked = res.result as unknown as { blocked?: boolean; scope?: string }
      if (maybeBlocked.blocked) {
        this.setData({
          blocked: true,
          blockedLabel: maybeBlocked.scope === 'annual' ? '本表单仅限年卡会员参与'
            : maybeBlocked.scope === 'member' ? '本表单仅限球队会员参与' : '暂无权限查看',
        })
        return
      }
      const { event: ev, myReg, roster, submittedCount, headcount, prepCount, prepTally, tally, exclusiveTaken, callerInfo } = res.result
      this._event = ev
      const isAdmin = callerInfo?.role === 'admin'

      this._prepSel = { ...(myReg?.prepAnswers ?? {}) }
      this._mainSel = { ...(myReg?.answers ?? {}) }
      this._taken = exclusiveTaken ?? {}

      const mt = callerInfo?.membershipType ?? 'none'
      const inScope = isAdmin
        || (ev.scope === 'all')
        || (ev.scope === 'member' && ['annual', 'per_session'].includes(mt))
        || (ev.scope === 'annual' && mt === 'annual')

      this.setData({
        event: ev,
        statusLabel: STATUS_LABEL[ev.status] ?? ev.status,
        descriptionHtml: markdownToHtml(ev.description || ''),
        eventDateStr: ev.eventDate ? formatDate(ev.eventDate) : '时间待定',
        deadlineStr: ev.deadline ? formatDate(ev.deadline) : '',
        scopeLabel: ev.scope === 'annual' ? '仅限年卡' : ev.scope === 'member' ? '年卡+次卡' : '所有人',
        actionLabel: ev.actionLabel || '提交',
        hasPrep: (ev.prepQuestions || []).length > 0,
        prepVM: buildVM(ev.prepQuestions || [], this._prepSel, prepTally, true, {}),
        mainVM: buildVM(ev.questions || [], this._mainSel, tally, ev.status === 'closed' || isAdmin, this._taken),
        roster: roster ?? [],
        showRoster: (roster ?? []).length > 0,
        showCount: submittedCount !== null,
        submittedCount: submittedCount ?? 0,
        headcount: headcount ?? 0,
        prepCount,
        myStatus: (myReg?.status as '' | 'prepped' | 'submitted' | 'withdrawn') ?? '',
        inScope,
        isAdmin,
      })
    } catch (err) {
      console.error('loadEvent failed', err)
      this.setData({ loadError: true })
    } finally {
      this.setData({ loading: false })
    }
  },
  retryLoad() { this.loadEvent() },

  goResults() {
    wx.navigateTo({ url: `/pages/admin/event-results/index?id=${this.data.eventId}` })
  },

  // ── answer pickers (shared by both rounds via data-round) ───────────────
  _sel(round: string) { return round === 'prep' ? this._prepSel : this._mainSel },

  pickOption(e: WechatMiniprogram.BaseEvent) {
    const { round, qid, opt, qtype, takenby } = e.currentTarget.dataset as { round: string; qid: string; opt: string; qtype: string; takenby: string }
    if (takenby) {
      wx.showToast({ title: `「${opt}」已被 ${takenby} 选走`, icon: 'none' })
      return
    }
    const sel = this._sel(round)
    if (qtype === 'multi') {
      const cur = Array.isArray(sel[qid]) ? [...(sel[qid] as string[])] : []
      const i = cur.indexOf(opt)
      if (i >= 0) cur.splice(i, 1)
      else cur.push(opt)
      sel[qid] = cur
    } else {
      sel[qid] = sel[qid] === opt ? '' : opt
    }
    this._rerender(round)
  },

  onAnswerText(e: WechatMiniprogram.Input) {
    const { round, qid } = e.currentTarget.dataset as { round: string; qid: string }
    this._sel(round)[qid] = e.detail.value
  },

  onAnswerNumber(e: WechatMiniprogram.BaseEvent) {
    const { round, qid, delta, max } = e.currentTarget.dataset as { round: string; qid: string; delta: number; max: number }
    const sel = this._sel(round)
    sel[qid] = Math.max(0, Math.min(Number(max), (Number(sel[qid]) || 0) + Number(delta)))
    this._rerender(round)
  },

  _rerender(round: string) {
    const ev = this._event
    if (!ev) return
    const key = round === 'prep' ? 'prepVM' : 'mainVM'
    const prev = this.data[key] as QuestionVM[]
    const questions = round === 'prep' ? (ev.prepQuestions || []) : (ev.questions || [])
    const taken = round === 'prep' ? {} : this._taken
    this.setData({
      [key]: buildVM(questions, this._sel(round), [], false, taken).map((q, i) => ({
        ...q,
        opts: q.opts.map((o, j) => ({ ...o, count: prev[i]?.opts[j]?.count ?? -1 })),
      })),
    })
  },

  async submitPrep() {
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'joinEvent',
        data: { eventId: this.data.eventId, mode: 'prep', prepAnswers: this._prepSel },
      })
      wx.showToast({ title: '已提交', icon: 'success' })
      this.loadEvent()
    } catch (err: unknown) {
      wx.showModal({ title: '提交失败', content: errText(err, '提交失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async submitMain() {
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'joinEvent',
        data: { eventId: this.data.eventId, mode: 'submit', answers: this._mainSel },
      })
      wx.showToast({ title: this.data.myStatus === 'submitted' ? '已更新' : `${this.data.actionLabel}成功`, icon: 'success' })
      this.loadEvent()
    } catch (err: unknown) {
      wx.showModal({ title: `${this.data.actionLabel}失败`, content: errText(err, '提交失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async withdrawEvent() {
    const res = await wx.showModal({ title: `撤回${this.data.actionLabel}？`, content: '', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'joinEvent',
        data: { eventId: this.data.eventId, mode: 'withdraw' },
      })
      wx.showToast({ title: '已撤回', icon: 'success' })
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
      title: this._event ? `${this._event.title} — 九州` : '九州',
      path: `/pages/event-detail/index?id=${this.data.eventId}`,
    }
  },
})
