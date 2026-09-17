import type { User, MembershipApplication, SeasonDrive, SeasonRenewal, EventQuestion } from '../../types/index'
import type { SeasonWaiverVM } from '../../app'
import { getCardTier, getNextTierInfo, TIER_COLOR, DEFAULT_THRESHOLDS, TIER_LABEL } from '../../utils/format'
import { ADMIN_CONTACT } from '../../utils/contact'

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']
const PRIORITY_LABELS = ['首选', '次选', '第三']
const MEMBERSHIP_LABEL: Record<string, string> = { annual: '年卡', per_session: '次卡', none: '未激活' }
const MEMBERSHIP_BADGE: Record<string, string> = { annual: 'badge-teal', per_session: 'badge-gold', none: 'badge-grey' }

interface PriorityPosition { pos: string; priorityLabel: string }

// The 2d context returned by canvas.getContext('2d') — only what's used here.
// miniprogram-api-typings has no declaration for it.
interface SigCtx {
  lineWidth: number
  lineCap: string
  lineJoin: string
  strokeStyle: string
  scale(x: number, y: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  clearRect(x: number, y: number, w: number, h: number): void
}

// Touches on a canvas carry x/y relative to the canvas, which the shipped
// TouchDetail type doesn't describe
type CanvasTouch = { x: number; y: number }

interface RenewalQVM {
  id: string
  title: string
  type: string
  required: boolean
  opts: Array<{ label: string; selected: boolean }>
  textValue: string
}

// Same approach as pages/event-detail: the picker mutates a plain selection
// map, and the view model is rebuilt from it after every tap.
function buildQVM(
  questions: EventQuestion[],
  sel: Record<string, string | string[]>,
): RenewalQVM[] {
  return (questions || []).map(q => {
    const picked = sel[q.id]
    return {
      id: q.id,
      title: q.title,
      type: q.type,
      required: q.required !== false,
      opts: (q.options || []).map(label => ({
        label,
        selected: Array.isArray(picked) ? picked.includes(label) : picked === label,
      })),
      textValue: typeof picked === 'string' ? picked : '',
    }
  })
}

Page({
  data: {
    user: null as User | null,
    displayName: '',
    priorityPositions: [] as PriorityPosition[],
    availablePositions: [] as string[],
    selectedCount: 0,
    tier: 'none',
    tierColor: '#00C9A7',
    tierLabel: '',
    nextTierGamesLeft: 0,
    hasNextTier: false,
    membershipLabel: '',
    membershipBadge: '',
    loading: true,
    loadError: false,
    needSetup: false,
    adminContact: ADMIN_CONTACT,
    saving: false,
    // 赛季年卡登记
    seasonDrive: null as Pick<SeasonDrive, 'season' | 'deadline' | 'note' | 'questions'> | null,
    myRenewal: null as Pick<SeasonRenewal, 'season' | 'response' | 'status' | 'birthday' | 'answers'> | null,
    renewalDeadlineStr: '',
    showRenewalModal: false,
    renewalBirthday: '',
    renewalNote: '',
    renewalQs: [] as RenewalQVM[],
    renewing: false,
    // 赛季确认书
    seasonWaiver: null as SeasonWaiverVM | null,
    showWaiverModal: false,
    waiverRealName: '',
    waiverAgreed: false,
    waiverSigning: false,
    waiverHasInk: false,
    // The signature and agree sections stay hidden until the text has been
    // scrolled through — reasonable notice is what makes a clickwrap stick
    waiverRead: false,
    saved: false,
    isAdmin: false,
    pendingApplications: 0,
    myAppStatus: '' as '' | 'pending' | 'rejected',
    myAppTypeLabel: '',
    myAppReason: '',
    showApplyModal: false,
    applyType: 'annual' as 'annual' | 'per_session',
    applyRealName: '',
    applyNote: '',
    applying: false,
  },

  _currentPositions: [] as string[],

  async onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    await this.loadProfile()
  },

  onShareAppMessage() {
    return { title: '九州足球俱乐部', path: '/pages/home/index' }
  },

  async loadProfile() {
    this.setData({ loading: true, loadError: false, needSetup: false })
    try {
      const app = getApp<{
        globalData: {
          userProfile: User | null
          openid: string | null
          myApplication: MembershipApplication | null
          pendingApplications: number
          seasonDrive: Pick<SeasonDrive, 'season' | 'deadline' | 'note' | 'questions'> | null
          myRenewal: Pick<SeasonRenewal, 'season' | 'response' | 'status' | 'birthday' | 'answers'> | null
          seasonWaiver: SeasonWaiverVM | null
        }
        loginReady?: Promise<void>
        refreshUserProfile: () => Promise<User | null>
        redeemPendingInvite?: () => Promise<string | null>
      }>()
      await (app.loginReady ?? Promise.resolve()).catch(() => {})
      const user = await app.refreshUserProfile()
      // A code parked before onboarding can be spent now
      if (user && app.redeemPendingInvite) {
        const status = await app.redeemPendingInvite()
        if (status === 'granted') {
          wx.showModal({
            title: '已加入球队',
            content: '你已通过邀请成为次卡会员，现在可以自己报名了。想要年卡可以在本页提交申请。',
            showCancel: false,
          })
          await app.refreshUserProfile()
        }
      }
      if (!user && app.globalData.openid) {
        // Logged in silently but never completed the profile — offer setup
        // (browsing stays free; this is the action point, not a wall)
        this.setData({ needSetup: true })
        return
      }
      if (user) {
        this._applyUser(user)
        const myApp = app.globalData.myApplication
        const TYPE_LABEL: Record<string, string> = { annual: '年卡', per_session: '次卡' }
        const drive = app.globalData.seasonDrive
        const renewal = app.globalData.myRenewal
        this.setData({
          pendingApplications: app.globalData.pendingApplications,
          myAppStatus: myApp?.status === 'pending' ? 'pending' : myApp?.status === 'rejected' ? 'rejected' : '',
          myAppTypeLabel: myApp ? (TYPE_LABEL[myApp.requestedType] ?? '') : '',
          myAppReason: myApp?.rejectReason ?? '',
          // The card only concerns current 年卡 holders — nobody else has
          // anything to continue
          seasonDrive: user.membershipType === 'annual' ? drive : null,
          myRenewal: renewal,
          renewalDeadlineStr: drive?.deadline
            ? `${new Date(drive.deadline).getMonth() + 1}月${new Date(drive.deadline).getDate()}日`
            : '',
          renewalBirthday: renewal?.birthday || user.birthday || '',
        })
        this.setData({ seasonWaiver: app.globalData.seasonWaiver })
        this._renewalSel = { ...(renewal?.answers ?? {}) }
        this.setData({ renewalQs: buildQVM(drive?.questions ?? [], this._renewalSel) })
      }
      // refreshUserProfile swallows network errors and returns null — treat
      // "no user and nothing cached" as a load failure, not a blank page.
      else if (!this.data.user) this.setData({ loadError: true })
    } catch (err) {
      console.error('loadProfile failed', err)
      if (!this.data.user) this.setData({ loadError: true })
    } finally {
      this.setData({ loading: false })
    }
  },

  retryLoad() { this.loadProfile() },

  // ── 赛季确认书 ───────────────────────────────────────────────────────────
  openWaiverModal() {
    this.setData({ showWaiverModal: true, waiverAgreed: false, waiverHasInk: false, waiverRead: false })
    wx.nextTick(() => {
      // Text short enough not to scroll counts as read — otherwise the gate
      // would never open
      wx.createSelectorQuery().in(this)
        .select('.waiver-body')
        .fields({ size: true, scrollOffset: true })
        .exec((res) => {
          const box = res?.[0] as { height?: number; scrollHeight?: number } | undefined
          if (box && box.scrollHeight !== undefined && box.height !== undefined
              && box.scrollHeight <= box.height + 4) {
            this.setData({ waiverRead: true })
          }
        })
      if (this.data.seasonWaiver?.handwriting && !this.data.seasonWaiver?.signed) {
        this._initSignaturePad()
      }
    })
  },

  onWaiverScrolledToEnd() {
    if (!this.data.waiverRead) this.setData({ waiverRead: true })
  },
  closeWaiverModal() { this.setData({ showWaiverModal: false }) },

  // ── signature pad (canvas 2d) ────────────────────────────────────────────
  _sigCanvas: null as WechatMiniprogram.Canvas | null,
  _sigCtx: null as SigCtx | null,

  _initSignaturePad() {
    wx.createSelectorQuery().in(this)
      .select('#sigCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const node = res?.[0]?.node as WechatMiniprogram.Canvas | undefined
        if (!node) return
        const { pixelRatio: dpr } = wx.getWindowInfo()
        const ctx = node.getContext('2d') as unknown as SigCtx
        node.width = res[0].width * dpr
        node.height = res[0].height * dpr
        ctx.scale(dpr, dpr)
        ctx.lineWidth = 2.5
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = '#e8f0eb'
        this._sigCanvas = node
        this._sigCtx = ctx
        this.setData({ waiverHasInk: false })
      })
  },

  onSigStart(e: WechatMiniprogram.TouchEvent) {
    const ctx = this._sigCtx
    if (!ctx) return
    const t = e.touches[0] as unknown as CanvasTouch
    ctx.beginPath()
    ctx.moveTo(t.x, t.y)
  },

  onSigMove(e: WechatMiniprogram.TouchEvent) {
    const ctx = this._sigCtx
    if (!ctx) return
    const t = e.touches[0] as unknown as CanvasTouch
    ctx.lineTo(t.x, t.y)
    ctx.stroke()
    if (!this.data.waiverHasInk) this.setData({ waiverHasInk: true })
  },

  // The transcription is what's comfortable to read on a phone; this opens
  // the document it was transcribed from.
  async openWaiverOriginal() {
    const fileID = this.data.seasonWaiver?.pdfFileId
    if (!fileID) return
    wx.showLoading({ title: '打开中' })
    try {
      const { fileList } = await wx.cloud.getTempFileURL({ fileList: [fileID] })
      const url = fileList?.[0]?.tempFileURL
      if (!url) throw new Error('原件暂时打不开')
      // Typings declare the sync DownloadTask return; awaited it resolves to
      // the success result, so the cast is describing what actually arrives
      const dl = await (wx.downloadFile({ url }) as unknown as Promise<{ tempFilePath: string }>)
      await wx.openDocument({ filePath: dl.tempFilePath, fileType: 'pdf', showMenu: true })
    } catch (err) {
      wx.showModal({
        title: '打不开原件',
        content: (err as { errMsg?: string; message?: string })?.errMsg || (err as Error)?.message || '请稍后再试',
        showCancel: false,
      })
    } finally {
      wx.hideLoading()
    }
  },

  clearSignature() {
    const canvas = this._sigCanvas
    const ctx = this._sigCtx
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    this.setData({ waiverHasInk: false })
  },

  // Canvas → temp file → 云存储, returning the cloud:// id to archive
  async _uploadSignature(): Promise<string> {
    const canvas = this._sigCanvas
    if (!canvas) throw new Error('签名区未就绪，请重新打开本页')
    const { tempFilePath } = await wx.canvasToTempFilePath({ canvas } as never, this)
    const uid = getApp<{ globalData: { userProfile: { _id: string } | null } }>().globalData.userProfile?._id ?? 'unknown'
    const season = this.data.seasonWaiver?.season ?? 'season'
    const res = await wx.cloud.uploadFile({
      cloudPath: `waiver-signatures/${season}_${uid}_${Date.now()}.png`,
      filePath: tempFilePath,
    })
    return res.fileID
  },
  onWaiverName(e: WechatMiniprogram.Input) { this.setData({ waiverRealName: e.detail.value }) },
  onWaiverAgree(e: WechatMiniprogram.SwitchChange) { this.setData({ waiverAgreed: e.detail.value }) },

  async submitWaiver() {
    const name = this.data.waiverRealName.trim()
    if (!name) { wx.showToast({ title: '请填写真实姓名', icon: 'none' }); return }
    if (!this.data.waiverAgreed) { wx.showToast({ title: '请先勾选已阅读', icon: 'none' }); return }
    const needsInk = !!this.data.seasonWaiver?.handwriting
    if (needsInk && !this.data.waiverHasInk) {
      wx.showToast({ title: '请在方框内签写姓名', icon: 'none' })
      return
    }
    this.setData({ waiverSigning: true })
    try {
      const signatureFileId = needsInk ? await this._uploadSignature() : ''
      await wx.cloud.callFunction({
        name: 'signSeasonWaiver',
        data: { realName: name, agreed: true, signatureFileId },
      })
      this.setData({ showWaiverModal: false })
      wx.showToast({ title: '已确认', icon: 'success' })
      this.loadProfile()
    } catch (err) {
      wx.showModal({
        title: '提交失败',
        content: (err as { errMsg?: string; message?: string })?.errMsg || (err as Error)?.message || '提交失败',
        showCancel: false,
      })
    } finally {
      this.setData({ waiverSigning: false })
    }
  },

  // ── 赛季年卡登记 ─────────────────────────────────────────────────────────
  _renewalSel: {} as Record<string, string | string[]>,

  pickRenewalOption(e: WechatMiniprogram.BaseEvent) {
    const { qid, opt, qtype } = e.currentTarget.dataset as { qid: string; opt: string; qtype: string }
    if (qtype === 'multi') {
      const cur = Array.isArray(this._renewalSel[qid]) ? [...(this._renewalSel[qid] as string[])] : []
      const i = cur.indexOf(opt)
      if (i >= 0) cur.splice(i, 1)
      else cur.push(opt)
      this._renewalSel[qid] = cur
    } else {
      // Tapping the chosen option again clears it
      this._renewalSel[qid] = this._renewalSel[qid] === opt ? '' : opt
    }
    this.setData({ renewalQs: buildQVM(this.data.seasonDrive?.questions ?? [], this._renewalSel) })
  },

  onRenewalAnswerText(e: WechatMiniprogram.Input) {
    const { qid } = e.currentTarget.dataset as { qid: string }
    this._renewalSel[qid] = e.detail.value
  },

  openRenewalModal() {
    this.setData({ showRenewalModal: true, renewalNote: '' })
  },
  closeRenewalModal() { this.setData({ showRenewalModal: false }) },
  onRenewalBirthdayChange(e: WechatMiniprogram.PickerChange) {
    // date picker gives YYYY-MM-DD; only 月-日 is kept and sent
    const v = String(e.detail.value)
    const parts = v.split('-')
    this.setData({ renewalBirthday: parts.length === 3 ? `${parts[1]}-${parts[2]}` : v })
  },
  onRenewalNoteInput(e: WechatMiniprogram.Input) { this.setData({ renewalNote: e.detail.value }) },

  async submitRenewal() {
    if (!this.data.renewalBirthday) {
      wx.showToast({ title: '请选择生日（月-日）', icon: 'none' })
      return
    }
    this.setData({ renewing: true })
    try {
      await wx.cloud.callFunction({
        name: 'respondSeasonRenewal',
        data: {
          response: 'continue',
          birthday: this.data.renewalBirthday,
          note: this.data.renewalNote.trim(),
          answers: this._renewalSel,
        },
      })
      this.setData({ showRenewalModal: false })
      wx.showModal({
        title: '已提交',
        content: '已记录你继续年卡的意愿，管理员确认后生效。',
        showCancel: false,
      })
      this.loadProfile()
    } catch (err) {
      wx.showModal({
        title: '提交失败',
        content: (err as { errMsg?: string; message?: string })?.errMsg || (err as Error)?.message || '提交失败',
        showCancel: false,
      })
    } finally {
      this.setData({ renewing: false })
    }
  },

  async declineRenewal() {
    const ok = await wx.showModal({
      title: '本赛季暂不继续？',
      content: '换季后你会转为次卡：仍然可以报名，但失去 R1 优先和带朋友的名额。之后想改主意随时可以重新确认。',
      confirmText: '暂不继续',
      confirmColor: '#F0B429',
    })
    if (!ok.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'respondSeasonRenewal', data: { response: 'decline' } })
      wx.showToast({ title: '已记录', icon: 'success' })
      this.loadProfile()
    } catch (err) {
      wx.showModal({
        title: '操作失败',
        content: (err as { errMsg?: string; message?: string })?.errMsg || (err as Error)?.message || '操作失败',
        showCancel: false,
      })
    }
  },

  goSetup() { wx.navigateTo({ url: '/pages/onboard/profile/index' }) },

  // 我的 must not be a dead end for a visitor with no profile
  goBrowse() { wx.switchTab({ url: '/pages/home/index' }) },


  _applyUser(user: User) {
    const app = getApp<{ globalData: { cardThresholds: typeof DEFAULT_THRESHOLDS | null } }>()
    const thresholds = app.globalData.cardThresholds ?? DEFAULT_THRESHOLDS
    const tier = getCardTier(user.attendanceCount, thresholds)
    const nextTier = getNextTierInfo(user.attendanceCount, thresholds)
    const priorityPositions: PriorityPosition[] = user.preferredPositions.map((pos, i) => ({
      pos,
      priorityLabel: PRIORITY_LABELS[i] ?? `${i + 1}`,
    }))
    const availablePositions = POSITIONS.filter(p => !user.preferredPositions.includes(p))
    this._currentPositions = [...user.preferredPositions]

    this.setData({
      user,
      displayName: user.displayName,
      priorityPositions,
      availablePositions,
      selectedCount: user.preferredPositions.length,
      tier,
      tierColor: TIER_COLOR[tier],
      tierLabel: TIER_LABEL[tier],
      hasNextTier: !!nextTier,
      nextTierGamesLeft: nextTier?.gamesLeft ?? 0,
      membershipLabel: MEMBERSHIP_LABEL[user.membershipType] ?? '未知',
      membershipBadge: MEMBERSHIP_BADGE[user.membershipType] ?? 'badge-grey',
      isAdmin: user.role === 'admin',
    })
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ displayName: e.detail.value })
  },

  removePosition(e: WechatMiniprogram.BaseEvent) {
    const pos = (e.currentTarget.dataset as { pos: string }).pos
    if (!this.data.user) return
    const newPositions = this._currentPositions.filter(p => p !== pos)
    this._currentPositions = newPositions
    this._applyUser({ ...this.data.user, preferredPositions: newPositions })
  },

  addPosition(e: WechatMiniprogram.BaseEvent) {
    const pos = (e.currentTarget.dataset as { pos: string }).pos
    if (!this.data.user) return
    if (this._currentPositions.length >= 3) return
    const newPositions = [...this._currentPositions, pos]
    this._currentPositions = newPositions
    this._applyUser({ ...this.data.user, preferredPositions: newPositions })
  },

  async saveProfile() {
    if (!this.data.displayName.trim()) {
      wx.showToast({ title: '请填写名字', icon: 'none' })
      return
    }
    if (this._currentPositions.length === 0) {
      wx.showToast({ title: '请至少选择一个惯用位置', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      await wx.cloud.callFunction({
        name: 'updateProfile',
        data: {
          displayName: this.data.displayName.trim(),
          preferredPositions: this._currentPositions,
        },
      })
      const trimmed = this.data.displayName.trim()
      this.setData({
        saved: true,
        'user.displayName': trimmed,
      })
      const app = getApp<{ globalData: { userProfile: User | null } }>()
      if (app.globalData.userProfile) {
        app.globalData.userProfile = {
          ...app.globalData.userProfile,
          displayName: trimmed,
          preferredPositions: this._currentPositions,
        }
      }
      setTimeout(() => this.setData({ saved: false }), 2000)
    } catch {
      wx.showToast({ title: '保存失败', icon: 'error' })
    } finally {
      this.setData({ saving: false })
    }
  },

  openApplyModal() {
    this.setData({
      showApplyModal: true,
      // Sensible default: non-annual members most often want annual
      applyType: this.data.user?.membershipType === 'annual' ? 'per_session' : 'annual',
      applyRealName: this.data.applyRealName || '',
      applyNote: '',
    })
  },
  closeApplyModal() { this.setData({ showApplyModal: false }) },
  noop() {},
  setApplyType(e: WechatMiniprogram.BaseEvent) {
    const type = (e.currentTarget.dataset as { type: 'annual' | 'per_session' }).type
    this.setData({ applyType: type })
  },
  onRealNameInput(e: WechatMiniprogram.Input) { this.setData({ applyRealName: e.detail.value }) },
  onNoteInput(e: WechatMiniprogram.Input) { this.setData({ applyNote: e.detail.value }) },

  async submitApplication() {
    if (!this.data.applyRealName.trim()) {
      wx.showToast({ title: '请填写真实姓名', icon: 'none' })
      return
    }
    this.setData({ applying: true })
    try {
      await wx.cloud.callFunction({
        name: 'applyMembership',
        data: {
          requestedType: this.data.applyType,
          realName: this.data.applyRealName.trim(),
          note: this.data.applyNote.trim(),
        },
      })
      wx.showToast({ title: '已提交，等待审批', icon: 'success' })
      this.setData({ showApplyModal: false })
      this.loadProfile()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg
        || (err as Error)?.message || '提交失败'
      wx.showModal({ title: '提交失败', content: msg, showCancel: false })
    } finally {
      this.setData({ applying: false })
    }
  },

  async cancelApplication() {
    const res = await wx.showModal({ title: '撤回申请？', content: '', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'applyMembership', data: { mode: 'cancel' } })
      wx.showToast({ title: '已撤回', icon: 'success' })
      this.loadProfile()
    } catch {
      wx.showToast({ title: '操作失败', icon: 'error' })
    }
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/dashboard/index' })
  },

  goAttendance() {
    wx.navigateTo({ url: '/pages/admin/attendance/index' })
  },

  async logout() {
    const res = await wx.showModal({ title: '确认退出？', content: '', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    const app = getApp<{ globalData: { userProfile: User | null; openid: string | null } }>()
    app.globalData.userProfile = null
    app.globalData.openid = null
    wx.reLaunch({ url: '/pages/login/index' })
  },
})
