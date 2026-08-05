import type { TeamEvent, EventQuestion } from '../../../types/index'
import { formatDate } from '../../../utils/format'

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', polling: '征集意见中', registration: '报名中', closed: '已截止', cancelled: '已取消',
}
const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-grey', polling: 'badge-gold', registration: 'badge-teal', closed: 'badge-grey', cancelled: 'badge-red',
}
const SCOPES = [
  { key: 'annual', label: '仅年卡' },
  { key: 'member', label: '年卡+次卡' },
  { key: 'all', label: '所有人' },
]
const Q_TYPES = [
  { key: 'single', label: '单选' },
  { key: 'multi', label: '多选' },
  { key: 'text', label: '填空' },
]

interface QForm {
  id: string
  title: string
  typeIndex: number
  options: string
  required: boolean
}

interface EventVM extends TeamEvent {
  statusLabel: string
  statusBadge: string
  dateStr: string
}

function toQForm(q: EventQuestion): QForm {
  return {
    id: q.id,
    title: q.title,
    typeIndex: Math.max(0, Q_TYPES.findIndex(t => t.key === q.type)),
    options: (q.options || []).join('/'),
    required: q.required !== false,
  }
}

function fromQForm(q: QForm) {
  return {
    id: q.id,
    title: q.title.trim(),
    type: Q_TYPES[q.typeIndex]?.key ?? 'single',
    options: q.options.split('/').map(s => s.trim()).filter(Boolean),
    required: q.required,
  }
}

const dstr = (ts: number | null, fallback: string) => {
  const d = ts ? new Date(ts) : null
  if (!d) return fallback
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const tstr = (ts: number | null, fallback: string) => {
  const d = ts ? new Date(ts) : null
  if (!d) return fallback
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function errText(err: unknown, fallback: string): string {
  const raw = (err as { errMsg?: string; message?: string })?.errMsg || (err as Error)?.message || ''
  const m = raw.match(/errMsg:\s*Error:\s*([^]+?)(?:\s+at\s|$)/)
  const text = (m ? m[1] : raw).trim()
  return text && text.length <= 60 ? text : fallback
}

Page({
  data: {
    events: [] as EventVM[],
    loading: true,
    showModal: false,
    saving: false,
    editingId: '',
    scopes: SCOPES,
    qTypes: Q_TYPES,
    form: {
      title: '', description: '', location: '',
      eventDate: '', eventTime: '19:00',
      deadlineDate: '', deadlineTime: '20:00',
      scopeIndex: 0,
      allowGuests: true,
      maxGuestsPer: 2,
      maxAttendees: '',
    },
    pollQs: [] as QForm[],
    signupQs: [] as QForm[],
  },

  onShow() { this.load() },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getEvents' }) as unknown as { result: { events: TeamEvent[] } }
      const events: EventVM[] = res.result.events.map(e => ({
        ...e,
        statusLabel: STATUS_LABEL[e.status] ?? e.status,
        statusBadge: STATUS_BADGE[e.status] ?? 'badge-grey',
        dateStr: e.eventDate ? formatDate(e.eventDate) : '时间待定',
      }))
      this.setData({ events })
    } catch (err) { console.error(err) }
    finally { this.setData({ loading: false }) }
  },

  goDetail(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/event-detail/index?id=${id}` })
  },

  openNew() {
    this.setData({
      showModal: true,
      editingId: '',
      form: {
        title: '', description: '', location: '',
        eventDate: '', eventTime: '19:00',
        deadlineDate: '', deadlineTime: '20:00',
        scopeIndex: 0, allowGuests: true, maxGuestsPer: 2, maxAttendees: '',
      },
      pollQs: [],
      signupQs: [],
    })
  },

  openEdit(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const ev = this.data.events.find(x => x.id === id)
    if (!ev) return
    this.setData({
      showModal: true,
      editingId: id,
      form: {
        title: ev.title, description: ev.description, location: ev.location,
        eventDate: dstr(ev.eventDate, ''), eventTime: tstr(ev.eventDate, '19:00'),
        deadlineDate: dstr(ev.deadline, ''), deadlineTime: tstr(ev.deadline, '20:00'),
        scopeIndex: Math.max(0, SCOPES.findIndex(s => s.key === ev.scope)),
        allowGuests: ev.allowGuests,
        maxGuestsPer: ev.maxGuestsPer,
        maxAttendees: ev.maxAttendees ? String(ev.maxAttendees) : '',
      },
      pollQs: (ev.pollQuestions || []).map(toQForm),
      signupQs: (ev.signupQuestions || []).map(toQForm),
    })
  },

  closeModal() { this.setData({ showModal: false }) },
  noop() {},

  onField(e: WechatMiniprogram.Input) {
    const field = (e.currentTarget.dataset as { field: string }).field
    this.setData({ [`form.${field}`]: e.detail.value })
  },
  onPicker(e: WechatMiniprogram.PickerChange) {
    const field = (e.currentTarget.dataset as { field: string }).field
    this.setData({ [`form.${field}`]: e.detail.value })
  },
  onScope(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'form.scopeIndex': Number(e.detail.value) })
  },
  onGuestsSwitch(e: WechatMiniprogram.SwitchChange) {
    this.setData({ 'form.allowGuests': e.detail.value })
  },

  addQ(e: WechatMiniprogram.BaseEvent) {
    const phase = (e.currentTarget.dataset as { phase: 'poll' | 'signup' }).phase
    const key = phase === 'poll' ? 'pollQs' : 'signupQs'
    const list = [...this.data[key]]
    list.push({
      id: `q_${Date.now().toString(36)}_${list.length}`,
      title: '', typeIndex: 0, options: '', required: true,
    })
    this.setData({ [key]: list })
  },
  delQ(e: WechatMiniprogram.BaseEvent) {
    const { phase, index } = e.currentTarget.dataset as { phase: 'poll' | 'signup'; index: number }
    const key = phase === 'poll' ? 'pollQs' : 'signupQs'
    const list = [...this.data[key]]
    list.splice(index, 1)
    this.setData({ [key]: list })
  },
  onQField(e: WechatMiniprogram.Input) {
    const { phase, index, field } = e.currentTarget.dataset as { phase: 'poll' | 'signup'; index: number; field: string }
    const key = phase === 'poll' ? 'pollQs' : 'signupQs'
    this.setData({ [`${key}[${index}].${field}`]: e.detail.value })
  },
  onQType(e: WechatMiniprogram.PickerChange) {
    const { phase, index } = e.currentTarget.dataset as { phase: 'poll' | 'signup'; index: number }
    const key = phase === 'poll' ? 'pollQs' : 'signupQs'
    this.setData({ [`${key}[${index}].typeIndex`]: Number(e.detail.value) })
  },
  onQRequired(e: WechatMiniprogram.SwitchChange) {
    const { phase, index } = e.currentTarget.dataset as { phase: 'poll' | 'signup'; index: number }
    const key = phase === 'poll' ? 'pollQs' : 'signupQs'
    this.setData({ [`${key}[${index}].required`]: e.detail.value })
  },

  async save() {
    const f = this.data.form
    if (!f.title.trim()) { wx.showToast({ title: '请填写标题', icon: 'none' }); return }
    const toTs = (d: string, t: string) => d ? new Date(`${d}T${t || '00:00'}:00`).getTime() : null
    this.setData({ saving: true })
    try {
      await wx.cloud.callFunction({
        name: 'adminSaveEvent',
        data: {
          eventId: this.data.editingId || undefined,
          title: f.title.trim(),
          description: f.description,
          location: f.location.trim(),
          eventDate: toTs(f.eventDate, f.eventTime),
          deadline: toTs(f.deadlineDate, f.deadlineTime),
          scope: SCOPES[f.scopeIndex]?.key ?? 'annual',
          allowGuests: f.allowGuests,
          maxGuestsPer: Number(f.maxGuestsPer) || 0,
          maxAttendees: f.maxAttendees ? Number(f.maxAttendees) : null,
          pollQuestions: this.data.pollQs.map(fromQForm),
          signupQuestions: this.data.signupQs.map(fromQForm),
        },
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ showModal: false })
      this.load()
    } catch (err: unknown) {
      wx.showModal({ title: '保存失败', content: errText(err, '保存失败'), showCancel: false })
    } finally {
      this.setData({ saving: false })
    }
  },
})
