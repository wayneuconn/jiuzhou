// 通知规则: scheduled / broadcast match notifications, executed by the
// runNotifyRules cloud function. Admins add, edit, switch off or delete them.

type Trigger = 'phase' | 'beforeKickoff' | 'matchDayAt'

interface Rule {
  id: string
  name: string
  enabled: boolean
  text: string
  trigger: Trigger
  phase?: string
  minutes?: number
  time?: string
  audience: string
  lastSent: { at: number; sent: number } | null
}

type RuleVM = Rule & { whenLabel: string; audienceLabel: string; lastLabel: string }

const TRIGGERS: { key: Trigger; label: string }[] = [
  { key: 'phase', label: '比赛进入某阶段时' },
  { key: 'beforeKickoff', label: '开球前一段时间' },
  { key: 'matchDayAt', label: '比赛当天固定时刻（美东）' },
]
const PHASES = [
  { key: 'registration_r1', label: 'R1 年卡报名开放' },
  { key: 'registration_r2', label: 'R2 全员报名开放' },
  { key: 'drafting', label: '开始选人' },
  { key: 'ready', label: '选人完成 / 名单就绪' },
]
const AUDIENCES = [
  { key: 'confirmed', label: '已报名（正式名单）' },
  { key: 'waitlist', label: '候补中' },
  { key: 'registered', label: '已报名 + 候补' },
  { key: 'unregistered_annual', label: '还没报名的年卡' },
  { key: 'unregistered_per_session', label: '还没报名的次卡' },
  { key: 'unregistered_members', label: '还没报名的会员（年卡+次卡）' },
]

const labelOf = (list: { key: string; label: string }[], key?: string) =>
  list.find(x => x.key === key)?.label ?? key ?? ''

function minutesLabel(m: number): string {
  if (m % 1440 === 0) return `${m / 1440} 天`
  if (m % 60 === 0) return `${m / 60} 小时`
  return `${m} 分钟`
}

function whenLabel(r: Rule): string {
  if (r.trigger === 'phase') return labelOf(PHASES, r.phase) + '时'
  if (r.trigger === 'beforeKickoff') return `开球前 ${minutesLabel(r.minutes ?? 0)}`
  return `比赛当天 ${r.time} (美东)`
}

function fmtTs(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const EMPTY_FORM = {
  id: '', name: '', text: '', enabled: true,
  triggerIdx: 0, phaseIdx: 0, minutes: '120', time: '12:00', audienceIdx: 0,
}

Page({
  data: {
    rules: [] as RuleVM[],
    loading: true,
    showModal: false,
    saving: false,
    triggers: TRIGGERS,
    phases: PHASES,
    audiences: AUDIENCES,
    form: { ...EMPTY_FORM },
  },

  onShow() { this.load() },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'adminNotifyRules', data: { action: 'list' } }) as unknown as {
        result: { rules: Rule[] }
      }
      const rules: RuleVM[] = res.result.rules.map(r => ({
        ...r,
        whenLabel: whenLabel(r),
        audienceLabel: labelOf(AUDIENCES, r.audience),
        lastLabel: r.lastSent ? `上次 ${fmtTs(r.lastSent.at)} 发出 ${r.lastSent.sent} 条` : '还没发过',
      }))
      this.setData({ rules })
    } catch (err) { console.error(err) }
    finally { this.setData({ loading: false }) }
  },

  openNew() { this.setData({ showModal: true, form: { ...EMPTY_FORM } }) },

  openEdit(e: WechatMiniprogram.BaseEvent) {
    const { id } = e.currentTarget.dataset as { id: string }
    const r = this.data.rules.find(x => x.id === id)
    if (!r) return
    this.setData({
      showModal: true,
      form: {
        id: r.id, name: r.name, text: r.text, enabled: r.enabled,
        triggerIdx: Math.max(0, TRIGGERS.findIndex(t => t.key === r.trigger)),
        phaseIdx: Math.max(0, PHASES.findIndex(p => p.key === r.phase)),
        minutes: String(r.minutes ?? 120),
        time: r.time ?? '12:00',
        audienceIdx: Math.max(0, AUDIENCES.findIndex(a => a.key === r.audience)),
      },
    })
  },

  closeModal() { this.setData({ showModal: false }) },
  noop() {},

  onName(e: WechatMiniprogram.Input) { this.setData({ 'form.name': e.detail.value }) },
  onText(e: WechatMiniprogram.Input) { this.setData({ 'form.text': e.detail.value }) },
  onMinutes(e: WechatMiniprogram.Input) { this.setData({ 'form.minutes': e.detail.value }) },
  onTrigger(e: WechatMiniprogram.PickerChange) { this.setData({ 'form.triggerIdx': Number(e.detail.value) }) },
  onPhase(e: WechatMiniprogram.PickerChange) { this.setData({ 'form.phaseIdx': Number(e.detail.value) }) },
  onAudience(e: WechatMiniprogram.PickerChange) { this.setData({ 'form.audienceIdx': Number(e.detail.value) }) },
  onTime(e: WechatMiniprogram.PickerChange) { this.setData({ 'form.time': e.detail.value as unknown as string }) },
  onEnabled(e: WechatMiniprogram.SwitchChange) { this.setData({ 'form.enabled': e.detail.value }) },

  async save() {
    const f = this.data.form
    this.setData({ saving: true })
    try {
      await wx.cloud.callFunction({
        name: 'adminNotifyRules',
        data: {
          action: 'save',
          id: f.id || undefined,
          rule: {
            name: f.name, text: f.text, enabled: f.enabled,
            trigger: TRIGGERS[f.triggerIdx].key,
            phase: PHASES[f.phaseIdx].key,
            minutes: Number(f.minutes),
            time: f.time,
            audience: AUDIENCES[f.audienceIdx].key,
          },
        },
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ showModal: false })
      this.load()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg || (err as Error)?.message || '保存失败'
      wx.showModal({ title: '保存失败', content: msg, showCancel: false })
    }
    finally { this.setData({ saving: false }) }
  },

  async toggle(e: WechatMiniprogram.SwitchChange) {
    const { id } = e.currentTarget.dataset as { id: string }
    try {
      await wx.cloud.callFunction({ name: 'adminNotifyRules', data: { action: 'toggle', id, enabled: e.detail.value } })
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
    this.load()
  },

  async deleteRule(e: WechatMiniprogram.BaseEvent) {
    const { id } = e.currentTarget.dataset as { id: string }
    const res = await wx.showModal({ title: '删除这条规则？', content: '删除后不再发送；想暂停可以直接关掉开关', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'adminNotifyRules', data: { action: 'delete', id } })
      wx.showToast({ title: '已删除', icon: 'success' })
      this.load()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg || (err as Error)?.message || '删除失败'
      wx.showModal({ title: '删除失败', content: msg, showCancel: false })
    }
  },
})
