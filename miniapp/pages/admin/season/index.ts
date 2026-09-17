import type { SeasonDrive, SeasonRenewal, Invite, EventQuestion } from '../../../types/index'

// Question types and the flat form shape match pages/admin/events — same
// builder, so an admin who has set up an event already knows this one.
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

interface RenewalVM extends SeasonRenewal {
  dateStr: string
  statusLabel: string
  statusBadge: string
  // Flattened for the template: wxml can't walk an id-keyed answer map
  answerLines: Array<{ title: string; value: string }>
}

interface InviteVM extends Invite {
  id: string
  dateStr: string
  expired: boolean
  stateLabel: string
  stateBadge: string
}

const RENEWAL_STATUS_LABEL: Record<string, string> = {
  pending: '待确认', confirmed: '已登记', rejected: '已驳回',
}
const RENEWAL_STATUS_BADGE: Record<string, string> = {
  pending: 'badge-gold', confirmed: 'badge-teal', rejected: 'badge-grey',
}

function fmt(ms: number | null | undefined): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function errText(err: unknown, fallback: string): string {
  return (err as { errMsg?: string; message?: string })?.errMsg
    || (err as Error)?.message || fallback
}

Page({
  data: {
    loading: true,
    busy: false,
    currentSeason: '',
    drive: null as SeasonDrive | null,
    driveOpen: false,
    deadlineStr: '',
    // Responses split by what the admin has to do with them
    toConfirm: [] as RenewalVM[],
    declined: [] as RenewalVM[],
    settled: [] as RenewalVM[],
    awaiting: [] as Array<{ uid: string; displayName: string; attendanceCount: number }>,
    wouldDowngrade: [] as Array<{ uid: string; displayName: string }>,
    invites: [] as InviteVM[],
    // 开启登记 form
    newSeason: '',
    newDeadline: '',
    newNote: '',
    // Question builder
    qTypes: Q_TYPES,
    questions: [] as QForm[],
    savingQuestions: false,
    // 赛季确认书
    waiver: null as { season: string; title: string; body: string; effectiveDate: string; version: number; required: boolean; updatedAt: number } | null,
    waiverTitle: '',
    waiverBody: '',
    waiverEffectiveDate: '',
    waiverRequired: true,
    waiverRequireResign: false,
    waiverSignatures: [] as Array<{ id: string; displayName: string; realName: string; version: number; signedAt: number; dateStr: string; clientIp: string }>,
    waiverPending: [] as Array<{ uid: string; displayName: string; membershipType: string }>,
    savingWaiver: false,
    showWaiverEditor: false,
  },

  onShow() { this.load() },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()) },

  async load() {
    this.setData({ loading: true })
    try {
      const [boardRes, inviteRes, waiverRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'adminSeasonAction', data: { action: 'board' } }),
        wx.cloud.callFunction({ name: 'adminManageInvite', data: { action: 'list' } }),
        wx.cloud.callFunction({ name: 'adminManageWaiver', data: { action: 'board' } }).catch(() => null),
      ]) as unknown as [
        { result: { currentSeason: string; drive: SeasonDrive | null; renewals: SeasonRenewal[]; awaiting: Array<{ uid: string; displayName: string; attendanceCount: number }>; wouldDowngrade: Array<{ uid: string; displayName: string }> } },
        { result: { invites: Array<Invite & { id: string; expired: boolean }> } },
        { result: {
          waiver: { season: string; title: string; body: string; effectiveDate: string; version: number; required: boolean; updatedAt: number } | null
          signatures: Array<{ id: string; displayName: string; realName: string; version: number; signedAt: number; clientIp: string }>
          pending: Array<{ uid: string; displayName: string; membershipType: string }>
        } } | null,
      ]

      const { currentSeason, drive, renewals, awaiting, wouldDowngrade } = boardRes.result
      const questions = drive?.questions ?? []
      const toVM = (r: SeasonRenewal): RenewalVM => ({
        ...r,
        dateStr: fmt(r.respondedAt),
        statusLabel: RENEWAL_STATUS_LABEL[r.status] ?? r.status,
        statusBadge: RENEWAL_STATUS_BADGE[r.status] ?? 'badge-grey',
        answerLines: questions
          .map(q => {
            const a = (r.answers ?? {})[q.id]
            const value = Array.isArray(a) ? a.join('、') : (a ?? '')
            return value ? { title: q.title, value } : null
          })
          .filter((x): x is { title: string; value: string } => x !== null),
      })
      const all = renewals.map(toVM)

      this.setData({
        currentSeason,
        drive,
        driveOpen: drive?.status === 'open',
        deadlineStr: fmt(drive?.deadline ?? null),
        toConfirm: all.filter(r => r.response === 'continue' && r.status === 'pending'),
        declined: all.filter(r => r.response === 'decline'),
        settled: all.filter(r => r.response === 'continue' && r.status !== 'pending'),
        awaiting,
        wouldDowngrade,
        invites: inviteRes.result.invites.map(i => ({
          ...i,
          dateStr: fmt(i.createdAt),
          stateLabel: i.status === 'used' ? `已用 · ${i.usedByName || ''}`
            : i.status === 'revoked' ? '已撤回'
            : i.expired ? '已过期' : '待使用',
          stateBadge: i.status === 'used' ? 'badge-teal'
            : i.status === 'revoked' || i.expired ? 'badge-grey' : 'badge-gold',
        })),
        newSeason: this.data.newSeason || drive?.season || '',
        // Don't clobber edits in progress on a refresh
        questions: this.data.savingQuestions ? this.data.questions : questions.map(toQForm),
      })

      const w = waiverRes?.result
      if (w) {
        this.setData({
          waiver: w.waiver,
          waiverSignatures: w.signatures.map(s => ({ ...s, dateStr: fmt(s.signedAt) })),
          waiverPending: w.pending,
          // Same rule as the question builder: never stomp an open editor
          waiverTitle: this.data.showWaiverEditor ? this.data.waiverTitle : (w.waiver?.title ?? ''),
          waiverBody: this.data.showWaiverEditor ? this.data.waiverBody : (w.waiver?.body ?? ''),
          waiverEffectiveDate: this.data.showWaiverEditor ? this.data.waiverEffectiveDate : (w.waiver?.effectiveDate ?? ''),
          waiverRequired: this.data.showWaiverEditor ? this.data.waiverRequired : (w.waiver?.required !== false),
        })
      }
    } catch (err) {
      wx.showModal({ title: '加载失败', content: errText(err, '加载失败'), showCancel: false })
    } finally {
      this.setData({ loading: false })
    }
  },

  onSeasonInput(e: WechatMiniprogram.Input) { this.setData({ newSeason: e.detail.value }) },
  onNoteInput(e: WechatMiniprogram.Input) { this.setData({ newNote: e.detail.value }) },
  onDeadlineChange(e: WechatMiniprogram.PickerChange) { this.setData({ newDeadline: String(e.detail.value) }) },

  async _call(data: Record<string, unknown>, okToast: string) {
    this.setData({ busy: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'adminSeasonAction', data })
      wx.showToast({ title: okToast, icon: 'success' })
      this.load()
      return res.result
    } catch (err) {
      wx.showModal({ title: '操作失败', content: errText(err, '操作失败'), showCancel: false })
      return null
    } finally {
      this.setData({ busy: false })
    }
  },

  // ── 赛季确认书 ───────────────────────────────────────────────────────────
  toggleWaiverEditor() { this.setData({ showWaiverEditor: !this.data.showWaiverEditor }) },
  onWaiverTitle(e: WechatMiniprogram.Input) { this.setData({ waiverTitle: e.detail.value }) },
  onWaiverBody(e: WechatMiniprogram.Input) { this.setData({ waiverBody: e.detail.value }) },
  onWaiverEffective(e: WechatMiniprogram.Input) { this.setData({ waiverEffectiveDate: e.detail.value }) },
  onWaiverRequired(e: WechatMiniprogram.SwitchChange) { this.setData({ waiverRequired: e.detail.value }) },
  onWaiverResign(e: WechatMiniprogram.SwitchChange) { this.setData({ waiverRequireResign: e.detail.value }) },

  async saveWaiver() {
    if (!this.data.waiverTitle.trim()) { wx.showToast({ title: '请填写标题', icon: 'none' }); return }
    if (!this.data.waiverBody.trim()) { wx.showToast({ title: '请填写正文', icon: 'none' }); return }
    if (this.data.waiverRequireResign) {
      const ok = await wx.showModal({
        title: '要求所有人重新确认？',
        content: '已确认过的人会全部回到未确认状态，并且在重新确认前无法报名。只有文件内容实质变化时才需要这样做。',
        confirmText: '确认',
        confirmColor: '#E53E3E',
      })
      if (!ok.confirm) return
    }
    this.setData({ savingWaiver: true })
    try {
      await wx.cloud.callFunction({
        name: 'adminManageWaiver',
        data: {
          action: 'save',
          title: this.data.waiverTitle.trim(),
          body: this.data.waiverBody,
          effectiveDate: this.data.waiverEffectiveDate.trim(),
          required: this.data.waiverRequired,
          requireResign: this.data.waiverRequireResign,
        },
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ showWaiverEditor: false, waiverRequireResign: false, savingWaiver: false })
      this.load()
    } catch (err) {
      this.setData({ savingWaiver: false })
      wx.showModal({ title: '保存失败', content: errText(err, '保存失败'), showCancel: false })
    }
  },

  // ── question builder ─────────────────────────────────────────────────────
  addQ() {
    const list = [...this.data.questions]
    if (list.length >= 10) { wx.showToast({ title: '最多 10 个问题', icon: 'none' }); return }
    list.push({ id: `q_${Date.now().toString(36)}_${list.length}`, title: '', typeIndex: 0, options: '', required: true })
    this.setData({ questions: list })
  },
  delQ(e: WechatMiniprogram.BaseEvent) {
    const { index } = e.currentTarget.dataset as { index: number }
    const list = [...this.data.questions]
    list.splice(index, 1)
    this.setData({ questions: list })
  },
  onQField(e: WechatMiniprogram.Input) {
    const { index, field } = e.currentTarget.dataset as { index: number; field: string }
    this.setData({ [`questions[${index}].${field}`]: e.detail.value })
  },
  onQType(e: WechatMiniprogram.PickerChange) {
    const { index } = e.currentTarget.dataset as { index: number }
    this.setData({ [`questions[${index}].typeIndex`]: Number(e.detail.value) })
  },
  onQRequired(e: WechatMiniprogram.SwitchChange) {
    const { index } = e.currentTarget.dataset as { index: number }
    this.setData({ [`questions[${index}].required`]: e.detail.value })
  },

  // Saving questions on a drive that's already open — answers already given
  // are kept; a dropped question just stops being asked.
  async saveQuestions() {
    const season = this.data.drive?.season
    if (!season) return
    this.setData({ savingQuestions: true })
    try {
      await wx.cloud.callFunction({
        name: 'adminSeasonAction',
        data: { action: 'editQuestions', season, questions: this.data.questions.map(fromQForm) },
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ savingQuestions: false })
      this.load()
    } catch (err) {
      this.setData({ savingQuestions: false })
      wx.showModal({ title: '保存失败', content: errText(err, '保存失败'), showCancel: false })
    }
  },

  async openDrive() {
    const season = this.data.newSeason.trim()
    if (!season) { wx.showToast({ title: '请填写赛季名称', icon: 'none' }); return }
    // Deadline is end of the chosen day, ET-ish — the cloud side only compares
    const deadline = this.data.newDeadline ? new Date(this.data.newDeadline + 'T23:59:59').getTime() : null
    const ok = await wx.showModal({
      title: `开启 ${season} 赛季年卡登记？`,
      content: '当前所有年卡会员都会收到通知，在「我的」页确认是否继续。',
      confirmText: '开启',
      confirmColor: '#00C9A7',
    })
    if (!ok.confirm) return
    await this._call({
      action: 'openDrive',
      season,
      deadline,
      note: this.data.newNote.trim(),
      questions: this.data.questions.map(fromQForm),
    }, '已开启')
  },

  async closeDrive() {
    const ok = await wx.showModal({
      title: '关闭登记？',
      content: '关闭后球员不能再自行确认，已提交的仍可继续处理。',
      confirmColor: '#F0B429',
    })
    if (!ok.confirm) return
    await this._call({ action: 'closeDrive', season: this.data.drive?.season }, '已关闭')
  },

  async confirmRenewal(e: WechatMiniprogram.BaseEvent) {
    const { id, name } = e.currentTarget.dataset as { id: string; name: string }
    const ok = await wx.showModal({
      title: `确认 ${name} 的年卡登记？`,
      content: `确认后 ${name} 即为 ${this.data.drive?.season} 赛季年卡，R1 优先报名生效。`,
      confirmColor: '#00C9A7',
    })
    if (!ok.confirm) return
    await this._call({ action: 'decideRenewal', renewalId: id, decision: 'confirmed' }, '已登记')
  },

  async rejectRenewal(e: WechatMiniprogram.BaseEvent) {
    const { id, name } = e.currentTarget.dataset as { id: string; name: string }
    const ok = await wx.showModal({
      title: `驳回 ${name}？`,
      content: '驳回后他仍是当前身份，可以重新确认。',
      confirmColor: '#E53E3E',
    })
    if (!ok.confirm) return
    await this._call({ action: 'decideRenewal', renewalId: id, decision: 'rejected' }, '已驳回')
  },

  // The big one: spell out exactly who loses 年卡 before doing it
  async rollover() {
    const season = this.data.drive?.season
    if (!season) return
    const names = this.data.wouldDowngrade.map(u => u.displayName).join('、')
    const ok = await wx.showModal({
      title: `换季到 ${season}？`,
      content: this.data.wouldDowngrade.length === 0
        ? `所有年卡都已登记，没有人会被降级。确认把赛季切到 ${season}？`
        : `以下 ${this.data.wouldDowngrade.length} 人未登记，将转为次卡（仍可报名，但失去 R1 优先和带朋友）：\n\n${names}`,
      confirmText: '确认换季',
      confirmColor: '#E53E3E',
    })
    if (!ok.confirm) return
    const res = await this._call({ action: 'rollover', season, confirm: true }, '换季完成') as { downgradedCount?: number } | null
    if (res) {
      wx.showModal({
        title: '换季完成',
        content: `赛季已切到 ${season}，${res.downgradedCount ?? 0} 人转为次卡。`,
        showCancel: false,
      })
    }
  },

  async createInvite() {
    const res = await wx.showModal({
      title: '生成邀请',
      content: '',
      editable: true,
      placeholderText: '这个邀请给谁？（如：老王，张三朋友）',
      confirmText: '生成',
      confirmColor: '#00C9A7',
    })
    if (!res.confirm) return
    const note = (res.content || '').trim()
    if (!note) { wx.showToast({ title: '请写上给谁', icon: 'none' }); return }
    this.setData({ busy: true })
    try {
      const out = await wx.cloud.callFunction({
        name: 'adminManageInvite',
        data: { action: 'create', note },
      }) as unknown as { result: { code: string } }
      this.load()
      wx.showModal({
        title: '邀请已生成',
        content: `邀请码 ${out.result.code}\n\n一码一人，用掉即失效，14 天有效。点这条邀请右边的「分享」发给本人。`,
        showCancel: false,
      })
    } catch (err) {
      wx.showModal({ title: '生成失败', content: errText(err, '生成失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async revokeInvite(e: WechatMiniprogram.BaseEvent) {
    const { code } = e.currentTarget.dataset as { code: string }
    const ok = await wx.showModal({ title: `撤回邀请 ${code}？`, content: '撤回后这个码不能再使用。', confirmColor: '#E53E3E' })
    if (!ok.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({ name: 'adminManageInvite', data: { action: 'revoke', code } })
      wx.showToast({ title: '已撤回', icon: 'success' })
      this.load()
    } catch (err) {
      wx.showModal({ title: '撤回失败', content: errText(err, '撤回失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  // Sharing the invite as a mini program card is the whole delivery mechanism:
  // one tap, one person, and the code rides in the path.
  onShareAppMessage(res: WechatMiniprogram.Page.IShareAppMessageOption) {
    const code = (res.target?.dataset as { code?: string } | undefined)?.code
    if (!code) {
      return { title: '九州足球', path: '/pages/home/index' }
    }
    return {
      title: '邀请你加入九州球队',
      path: `/pages/home/index?invite=${code}`,
    }
  },
})
