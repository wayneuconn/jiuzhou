import type { Match, Registration, MatchTag } from '../../types/index'
import { formatDate, STATUS_LABEL, STATUS_BADGE, REG_STATUS_LABEL } from '../../utils/format'

const SUBSCRIBE_TEMPLATES = {
  promoted: 'REPLACE_PROMOTED_TEMPLATE_ID',
  draftReady: 'REPLACE_DRAFT_READY_TEMPLATE_ID',
}

const POS_GROUPS = [
  { key: 'all', label: '全部', positions: [] as string[] },
  { key: 'GK',  label: 'GK',  positions: ['GK'] },
  { key: 'DEF', label: 'DEF', positions: ['CB', 'LB', 'RB'] },
  { key: 'MID', label: 'MID', positions: ['CDM', 'CM', 'CAM'] },
  { key: 'FWD', label: 'FWD', positions: ['LW', 'RW', 'ST'] },
]

interface RegVM extends Registration {
  statusLabel: string
  isCaptainA: boolean
  isCaptainB: boolean
  isLate: boolean
  isDangerous: boolean
  teamLabel: string
}

type ActionState = 'cancelled' | 'promoted' | 'confirmed' | 'waitlist' | 'excused' | 'canRegister' | 'canWaitlist' | 'r1Blocked' | 'closed' | 'loading'

Page({
  data: {
    matchId: '',
    match: null as Match | null,
    confirmedList: [] as RegVM[],
    waitlistList: [] as RegVM[],
    excusedList: [] as RegVM[],
    unassignedList: [] as RegVM[],
    teamAList: [] as RegVM[],
    teamBList: [] as RegVM[],
    myReg: null as Registration | null,
    myRoster: 0,
    actionState: 'loading' as ActionState,
    slotsLeft: 0,
    confirmedCount: 0,
    waitlistCount: 0,
    captainAName: '',
    captainBName: '',
    captainAIndex: 0,
    captainBIndex: 0,
    dateStr: '',
    statusLabel: '',
    statusBadge: '',
    agreementText: '',
    timeLeftStr: '',
    timeLeftMs: 0,
    posFilter: 'all',
    posGroups: POS_GROUPS,
    filteredRoster: [] as RegVM[],
    showAgreementModal: false,
    showWaitlistModal: false,
    autoAccept: true,
    loading: true,
    busy: false,
    isAdmin: false,
    showDraft: false,
    showBehaviorTags: false,
    showAdminCaptain: false,
  },

  _timerInterval: null as ReturnType<typeof setInterval> | null,
  _registrations: [] as Registration[],
  _confirmedListRaw: [] as RegVM[],

  onLoad(options: Record<string, string>) {
    const matchId = options.id || ''
    this.setData({ matchId })
    this.loadMatch()
  },

  onShow() {
    if (this.data.matchId) this.loadMatch()
  },

  onUnload() {
    if (this._timerInterval) clearInterval(this._timerInterval)
  },

  async loadMatch() {
    if (!this.data.matchId) return
    this.setData({ loading: true })
    try {
      const app = getApp<{
        globalData: { userProfile: { _id: string; role: string; membershipType: string } | null }
      }>()
      const user = app.globalData.userProfile

      const cfRes = await wx.cloud.callFunction({
        name: 'getMatchDetail',
        data: { matchId: this.data.matchId },
      }) as unknown as { result: { match: Match; registrations: Registration[]; agreementText: string } }

      const { match, registrations, agreementText } = cfRes.result
      this._registrations = registrations

      const toVM = (r: Registration): RegVM => ({
        ...r,
        statusLabel: REG_STATUS_LABEL[r.status] ?? r.status,
        isCaptainA: r.uid === match.captainA,
        isCaptainB: r.uid === match.captainB,
        isLate: (r.tags ?? []).includes('late'),
        isDangerous: (r.tags ?? []).includes('dangerous'),
        teamLabel: r.team ?? '',
      })

      const active = registrations.filter(r => r.status !== 'withdrawn')
      const confirmedList: RegVM[] = active
        .filter(r => r.status === 'confirmed' || r.status === 'promoted')
        .map(toVM)
      const waitlistList: RegVM[] = active
        .filter(r => r.status === 'waitlist')
        .sort((a, b) => (a.waitlistPosition ?? 99) - (b.waitlistPosition ?? 99))
        .map(toVM)
      const excusedList: RegVM[] = active.filter(r => r.status === 'excused').map(toVM)

      const myReg = user ? (registrations.find(r => r.uid === user._id) ?? null) : null
      const myRosterIdx = myReg ? confirmedList.findIndex(r => r.uid === myReg.uid) : -1
      const myRoster = myRosterIdx >= 0 ? myRosterIdx + 1 : 0
      const isAdmin = user?.role === 'admin'
      const isCaptainA = !!match.captainA && user?._id === match.captainA
      const isCaptainB = !!match.captainB && user?._id === match.captainB

      const confirmedCount = confirmedList.length
      const waitlistCount = waitlistList.length
      const slotsLeft = Math.max(0, match.maxPlayers - confirmedCount)
      const isFull = confirmedCount >= match.maxPlayers
      const isOpen = match.status === 'registration_r1' || match.status === 'registration_r2'
      const isR1 = match.status === 'registration_r1'
      const r1Ok = isAdmin || user?.membershipType === 'annual'
      const notRegistered = !myReg || myReg.status === 'withdrawn' || myReg.status === 'excused'

      let actionState: ActionState = 'loading'
      if (!user) {
        actionState = 'closed'
      } else if (match.status === 'cancelled') {
        actionState = 'cancelled'
      } else if (myReg?.status === 'promoted') {
        actionState = 'promoted'
      } else if (myReg?.status === 'confirmed') {
        actionState = 'confirmed'
      } else if (myReg?.status === 'waitlist') {
        actionState = 'waitlist'
      } else if (myReg?.status === 'excused') {
        actionState = 'excused'
      } else if (notRegistered && isOpen && !isFull && (!isR1 || r1Ok)) {
        actionState = 'canRegister'
      } else if (notRegistered && isOpen && isFull && (!isR1 || r1Ok)) {
        actionState = 'canWaitlist'
      } else if (notRegistered && isR1 && !r1Ok) {
        actionState = 'r1Blocked'
      } else {
        actionState = 'closed'
      }

      const unassignedList = confirmedList.filter(r => !r.team)
      const teamAList = confirmedList.filter(r => r.team === 'A')
      const teamBList = confirmedList.filter(r => r.team === 'B')

      const captainAName = registrations.find(r => r.uid === match.captainA)?.displayName ?? ''
      const captainBName = registrations.find(r => r.uid === match.captainB)?.displayName ?? ''
      const captainAIndex = confirmedList.findIndex(r => r.uid === match.captainA)
      const captainBIndex = confirmedList.findIndex(r => r.uid === match.captainB)

      const isDraftPhase = match.status === 'drafting'
      const showDraft = (isAdmin || isCaptainA || isCaptainB) && isDraftPhase && !!match.captainA && !!match.captainB
      const showBehaviorTags = isAdmin && (match.status === 'ready' || match.status === 'completed') && confirmedCount > 0
      const showAdminCaptain = isAdmin && confirmedCount > 0

      this._confirmedListRaw = confirmedList

      this.setData({
        match,
        confirmedList,
        waitlistList,
        excusedList,
        unassignedList,
        teamAList,
        teamBList,
        myReg,
        myRoster,
        actionState,
        confirmedCount,
        waitlistCount,
        slotsLeft,
        captainAName,
        captainBName,
        captainAIndex: captainAIndex >= 0 ? captainAIndex : 0,
        captainBIndex: captainBIndex >= 0 ? captainBIndex : 0,
        dateStr: formatDate(match.date),
        statusLabel: STATUS_LABEL[match.status] ?? match.status,
        statusBadge: STATUS_BADGE[match.status] ?? 'badge-grey',
        agreementText: agreementText || match.agreementText || '报名即表示您同意遵守队伍规则并出席已报名的比赛。',
        isAdmin,
        showDraft,
        showBehaviorTags,
        showAdminCaptain,
        filteredRoster: confirmedList,
        posFilter: 'all',
      })

      this._startTimer(myReg)
    } catch (err) {
      console.error('loadMatch failed', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  _startTimer(myReg: Registration | null) {
    if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null }
    if (myReg?.status !== 'promoted' || !myReg.confirmDeadline) return
    const deadline = myReg.confirmDeadline as number
    const tick = () => {
      const ms = Math.max(0, deadline - Date.now())
      const s = Math.floor(ms / 1000)
      this.setData({
        timeLeftMs: ms,
        timeLeftStr: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
      })
      if (ms <= 0 && this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null }
    }
    tick()
    this._timerInterval = setInterval(tick, 1000)
  },

  setPosFilter(e: WechatMiniprogram.BaseEvent) {
    const key = (e.currentTarget.dataset as { key: string }).key
    const grp = POS_GROUPS.find(g => g.key === key)
    const filteredRoster = key === 'all'
      ? this._confirmedListRaw
      : this._confirmedListRaw.filter((r: RegVM) => {
          const first = (r.preferredPositions ?? [])[0]
          return first && (grp?.positions ?? []).includes(first)
        })
    this.setData({ posFilter: key, filteredRoster })
  },

  openAgreementModal()  { this.setData({ showAgreementModal: true }) },
  closeAgreementModal() { this.setData({ showAgreementModal: false }) },
  openWaitlistModal()   { this.setData({ showWaitlistModal: true }) },
  closeWaitlistModal()  { this.setData({ showWaitlistModal: false }) },
  toggleAutoAccept()    { this.setData({ autoAccept: !this.data.autoAccept }) },

  async register() {
    this.setData({ showAgreementModal: false, busy: true })
    try {
      try {
        await wx.requestSubscribeMessage({
          tmplIds: [SUBSCRIBE_TEMPLATES.promoted, SUBSCRIBE_TEMPLATES.draftReady],
        })
      } catch (_) {}
      const res = await wx.cloud.callFunction({
        name: 'registerForMatch',
        data: { matchId: this.data.matchId },
      }) as unknown as { result: { status: string } }
      wx.showToast({ title: res.result.status === 'waitlist' ? '已加入候补' : '报名成功', icon: 'success' })
      this.loadMatch()
    } catch (err: unknown) {
      wx.showToast({ title: (err as Error).message || '报名失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async registerWaitlist() {
    this.setData({ showWaitlistModal: false, busy: true })
    try {
      try {
        await wx.requestSubscribeMessage({
          tmplIds: [SUBSCRIBE_TEMPLATES.promoted, SUBSCRIBE_TEMPLATES.draftReady],
        })
      } catch (_) {}
      await wx.cloud.callFunction({
        name: 'registerForMatch',
        data: { matchId: this.data.matchId, waitlist: true, autoAccept: this.data.autoAccept },
      })
      wx.showToast({ title: '已加入候补', icon: 'success' })
      this.loadMatch()
    } catch (err: unknown) {
      wx.showToast({ title: (err as Error).message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async confirmSpot() {
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({ name: 'confirmSpot', data: { matchId: this.data.matchId } })
      wx.showToast({ title: '已确认报名', icon: 'success' })
      this.loadMatch()
    } catch {
      wx.showToast({ title: '操作失败', icon: 'error' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async withdraw() {
    const res = await wx.showModal({ title: '确认退出？', content: '退出后可重新报名', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({ name: 'withdrawFromMatch', data: { matchId: this.data.matchId } })
      wx.showToast({ title: '已退出', icon: 'success' })
      this.loadMatch()
    } catch {
      wx.showToast({ title: '操作失败', icon: 'error' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async assignTeam(e: WechatMiniprogram.BaseEvent) {
    const { uid, team } = e.currentTarget.dataset as { uid: string; team: 'A' | 'B' | null }
    try {
      await wx.cloud.callFunction({
        name: 'updateMatchStatus',
        data: { action: 'assignTeam', matchId: this.data.matchId, uid, team },
      })
      this.loadMatch()
    } catch {
      wx.showToast({ title: '操作失败', icon: 'error' })
    }
  },

  async toggleTag(e: WechatMiniprogram.BaseEvent) {
    const { uid, tag } = e.currentTarget.dataset as { uid: string; tag: 'late' | 'dangerous' }
    const reg = this._registrations.find((r: Registration) => r.uid === uid)
    if (!reg) return
    const tags: MatchTag[] = reg.tags ?? []
    const has = tags.includes(tag)
    const newTags = has ? tags.filter((t: MatchTag) => t !== tag) : [...tags, tag]
    try {
      await wx.cloud.callFunction({
        name: 'updateMatchStatus',
        data: { action: 'toggleTag', matchId: this.data.matchId, uid, tags: newTags },
      })
      this.loadMatch()
    } catch {
      wx.showToast({ title: '操作失败', icon: 'error' })
    }
  },

  async setCaptain(e: WechatMiniprogram.BaseEvent & { detail: { value: number } }) {
    const slot = (e.currentTarget.dataset as { slot: string }).slot
    const idx = e.detail.value
    const uid = this.data.confirmedList[idx]?.uid ?? null
    try {
      await wx.cloud.callFunction({
        name: 'updateMatchStatus',
        data: { action: 'setCaptain', matchId: this.data.matchId, slot, uid },
      })
      this.loadMatch()
    } catch {
      wx.showToast({ title: '设置失败', icon: 'error' })
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.match ? `${this.data.match.location} - 一起踢球` : '九州比赛',
      path: `/pages/match-detail/index?id=${this.data.matchId}`,
    }
  },
})
