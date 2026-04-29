import type { Match, Registration } from '../../types/index'
import { formatDate, STATUS_LABEL, STATUS_BADGE, REG_STATUS_LABEL } from '../../utils/format'

const SUBSCRIBE_TEMPLATES = {
  promoted: 'REPLACE_PROMOTED_TEMPLATE_ID',
  draftReady: 'REPLACE_DRAFT_READY_TEMPLATE_ID',
}

interface RegistrationVM extends Registration {
  statusLabel: string
}

Page({
  data: {
    matchId: '' as string,
    match: null as Match | null,
    registrations: [] as Registration[],
    confirmedList: [] as RegistrationVM[],
    waitlistList: [] as RegistrationVM[],
    myReg: null as Registration | null,
    myRegStatusLabel: '',
    confirmedCount: 0,
    waitlistCount: 0,
    canRegister: false,
    dateStr: '',
    statusLabel: '',
    statusBadge: '',
    loading: true,
    isAdmin: false,
  },

  onLoad(options: Record<string, string>) {
    const matchId = options.id || ''
    this.setData({ matchId })
    this.loadMatch()
  },

  onShow() {
    if (this.data.matchId) this.loadMatch()
  },

  async loadMatch() {
    if (!this.data.matchId) return
    this.setData({ loading: true })
    try {
      const app = getApp<{ globalData: { userProfile: { _id: string; role: string } | null } }>()
      const user = app.globalData.userProfile

      const cfRes = await wx.cloud.callFunction({
        name: 'getMatchDetail',
        data: { matchId: this.data.matchId },
      }) as { result: { match: Match; registrations: Registration[] } }
      const { match, registrations } = cfRes.result

      const myReg = user ? registrations.find(r => r.uid === user._id) ?? null : null

      const active = registrations.filter(r => r.status !== 'withdrawn' && r.status !== 'excused')
      const confirmedList: RegistrationVM[] = active
        .filter(r => r.status === 'confirmed' || r.status === 'promoted')
        .map(r => ({ ...r, statusLabel: REG_STATUS_LABEL[r.status] ?? r.status }))
      const waitlistList: RegistrationVM[] = active
        .filter(r => r.status === 'waitlist')
        .sort((a, b) => (a.waitlistPosition ?? 99) - (b.waitlistPosition ?? 99))
        .map(r => ({ ...r, statusLabel: REG_STATUS_LABEL[r.status] ?? r.status }))

      const canRegister = !myReg || myReg.status === 'withdrawn' || myReg.status === 'excused'

      this.setData({
        match,
        registrations,
        confirmedList,
        waitlistList,
        myReg,
        myRegStatusLabel: myReg ? (REG_STATUS_LABEL[myReg.status] ?? myReg.status) : '',
        confirmedCount: confirmedList.length,
        waitlistCount: waitlistList.length,
        canRegister,
        dateStr: formatDate(match.date),
        statusLabel: STATUS_LABEL[match.status] ?? match.status,
        statusBadge: STATUS_BADGE[match.status] ?? 'badge-grey',
        isAdmin: user?.role === 'admin',
      })
    } catch (err) {
      console.error('loadMatch failed', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  async register() {
    // Request subscribe permissions before registering
    try {
      await wx.requestSubscribeMessage({
        tmplIds: [SUBSCRIBE_TEMPLATES.promoted, SUBSCRIBE_TEMPLATES.draftReady],
      })
    } catch (_) {
      // User denied or dismissed — still allow registration
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'registerForMatch',
        data: { matchId: this.data.matchId },
      }) as { result: { status: string } }
      const status = res.result.status
      wx.showToast({
        title: status === 'waitlist' ? '已加入候补' : '报名成功',
        icon: 'success',
      })
      this.loadMatch()
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '报名失败', icon: 'error' })
    }
  },

  async withdraw() {
    const confirm = await wx.showModal({ title: '确认退出报名？', content: '' })
    if (!confirm.confirm) return
    try {
      await wx.cloud.callFunction({
        name: 'withdrawFromMatch',
        data: { matchId: this.data.matchId },
      })
      wx.showToast({ title: '已退出', icon: 'success' })
      this.loadMatch()
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '操作失败', icon: 'error' })
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.match ? `${this.data.match.location} - 一起踢球` : '九州比赛',
      path: `/pages/match-detail/index?id=${this.data.matchId}`,
    }
  },
})
