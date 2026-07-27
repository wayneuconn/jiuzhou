import type { Match, Registration, MatchTag } from '../../types/index'
import { formatDate, STATUS_LABEL, STATUS_BADGE, REG_STATUS_LABEL } from '../../utils/format'

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

const SUBSCRIBE_TEMPLATES = {
  promoted: 'Pd7bU1yJztmPwhicK6vI5nU0vqeRvXRw3aOl3IBTNdg',
  matchCancelled: 'YzYbL382sXtwfSgiireQodg3dQwfCuUAe2eAu2xVJ9I',
}

const POS_GROUPS = [
  { key: 'all', label: '全部', positions: [] as string[] },
  { key: 'GK',  label: 'GK',  positions: ['GK'] },
  { key: 'DEF', label: 'DEF', positions: ['CB', 'LB', 'RB'] },
  { key: 'MID', label: 'MID', positions: ['CDM', 'CM', 'CAM'] },
  { key: 'FWD', label: 'FWD', positions: ['LW', 'RW', 'ST'] },
]

const ALL_POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']

interface RegVM extends Registration {
  statusLabel: string
  isCaptainA: boolean
  isCaptainB: boolean
  isLate: boolean
  isDangerous: boolean
  isAbsent: boolean
  teamLabel: string
  goals: number
  assists: number
  isFriend: boolean
  friendOf: string
  tierTag: string
  canRemove: boolean
}

type ActionState = 'cancelled' | 'promoted' | 'confirmed' | 'waitlist' | 'excused' | 'canRegister' | 'canWaitlist' | 'r1Blocked' | 'banned' | 'needProfile' | 'closed' | 'loading'

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
    isEntry: false,
    isAdmin: false,
    showDraft: false,
    showBehaviorTags: false,
    showAdminCaptain: false,
    showScoreEditor: false,
    showTeams: false,
    hasScore: false,
    scoreAInput: '',
    scoreBInput: '',
    banLeft: 0,
    loadError: false,
    canBringFriend: false,
    myWaitRank: 0,
    waitlistBtnText: '',
    scheduleLine1: '',
    scheduleLine2: '',
    showFriendModal: false,
    friendName: '',
    allPositions: ALL_POSITIONS,
    friendPosMap: {} as Record<string, boolean>,
    showRulesModal: false,
    statsDirty: false,
    captainPickerTeam: '' as 'A' | 'B' | '',
    draftTurnTeam: '' as 'A' | 'B' | '',
    draftTurnLabel: '',
  },

  _timerInterval: null as ReturnType<typeof setInterval> | null,
  _registrations: [] as Registration[],
  _confirmedListRaw: [] as RegVM[],
  _shareTempPath: '' as string,
  _changedStats: new Set<string>(),

  onLoad(options: Record<string, string>) {
    const matchId = options.id || ''
    const isEntry = getCurrentPages().length === 1
    this.setData({ matchId, isEntry })
    this.loadMatch()
  },

  onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    if (this.data.matchId) this.loadMatch()
  },

  onUnload() {
    if (this._timerInterval) clearInterval(this._timerInterval)
  },

  async loadMatch() {
    if (!this.data.matchId) return
    this.setData({ loading: true, loadError: false })
    try {
      const app = getApp<{
        globalData: { userProfile: { _id: string; role: string; membershipType: string; banGamesLeft?: number } | null }
        loginReady?: Promise<void>
      }>()
      // Cold start: the page loads before autoLogin resolves — wait for it,
      // otherwise a logged-in user is rendered as logged-out ("报名已关闭").
      await (app.loginReady ?? Promise.resolve()).catch(() => {})

      const cfRes = await wx.cloud.callFunction({
        name: 'getMatchDetail',
        data: { matchId: this.data.matchId },
      }) as unknown as {
        result: {
          match: Match
          registrations: Registration[]
          agreementText: string
          callerInfo: { membershipType: string; role: string; banGamesLeft: number } | null
        }
      }

      const { match, registrations, agreementText, callerInfo } = cfRes.result
      this._registrations = registrations

      // Overlay the server's fresh identity on the login-time snapshot, so a
      // membership change by an admin takes effect without an app restart.
      let user = app.globalData.userProfile
      if (user && callerInfo) {
        user = { ...user, ...callerInfo } as typeof user
        app.globalData.userProfile = user
      }

      const isAdmin = user?.role === 'admin'

      const toVM = (r: Registration): RegVM => ({
        ...r,
        statusLabel: REG_STATUS_LABEL[r.status] ?? r.status,
        isCaptainA: r.uid === match.captainA,
        isCaptainB: r.uid === match.captainB,
        isLate: (r.tags ?? []).includes('late'),
        isDangerous: (r.tags ?? []).includes('dangerous'),
        isAbsent: (r.tags ?? []).includes('absent'),
        teamLabel: r.team ?? '',
        goals: r.goals ?? 0,
        assists: r.assists ?? 0,
        isFriend: !!r.isGuest,
        friendOf: r.broughtByName ?? '',
        tierTag: r.isGuest ? '朋友' : ((r.waitlistTier ?? 1) === 3 ? '次卡' : ''),
        canRemove: !!r.isGuest && (isAdmin || r.broughtBy === user?._id),
      })

      const active = registrations.filter(r => r.status !== 'withdrawn')
      const confirmedList: RegVM[] = active
        .filter(r => r.status === 'confirmed' || r.status === 'promoted')
        .map(toVM)
      // Waitlist order = promotion order: priority tier first, then arrival
      const waitlistList: RegVM[] = active
        .filter(r => r.status === 'waitlist')
        .map(toVM)
        .sort((a, b) =>
          ((a.waitlistTier ?? 1) - (b.waitlistTier ?? 1))
          || ((a.waitlistPosition ?? 99) - (b.waitlistPosition ?? 99)))
      const excusedList: RegVM[] = active.filter(r => r.status === 'excused' && !r.isGuest).map(toVM)

      const myReg = user ? (registrations.find(r => r.uid === user._id) ?? null) : null
      const myRosterIdx = myReg ? confirmedList.findIndex(r => r.uid === myReg.uid) : -1
      const myRoster = myRosterIdx >= 0 ? myRosterIdx + 1 : 0
      const myWaitRank = myReg?.status === 'waitlist'
        ? waitlistList.findIndex(r => r.uid === myReg.uid) + 1
        : 0
      const isCaptainA = !!match.captainA && user?._id === match.captainA
      const isCaptainB = !!match.captainB && user?._id === match.captainB

      const confirmedCount = confirmedList.length
      const waitlistCount = waitlistList.length
      const slotsLeft = Math.max(0, match.maxPlayers - confirmedCount)
      const isFull = confirmedCount >= match.maxPlayers
      const isOpen = match.status === 'registration_r1' || match.status === 'registration_r2'
      const isR1 = match.status === 'registration_r1'
      const myTier = isAdmin || user?.membershipType === 'annual' ? 1 : 3
      const isPerSession = user?.membershipType === 'per_session'
      // Someone with equal/higher priority already waiting → no queue jumping
      const hasPriorityWaiters = waitlistList.some(r => (r.waitlistTier ?? 1) <= myTier)
      const notRegistered = !myReg || myReg.status === 'withdrawn' || myReg.status === 'excused'
      const banLeft = user?.banGamesLeft ?? 0

      let actionState: ActionState = 'loading'
      let waitlistBtnText = ''
      if (!user) {
        // New visitor from a shared link who hasn't completed onboarding —
        // give them an explicit path in instead of a dead "报名已关闭".
        actionState = isOpen ? 'needProfile' : 'closed'
      } else if (match.status === 'cancelled') {
        actionState = 'cancelled'
      } else if (notRegistered && isOpen && banLeft > 0) {
        actionState = 'banned'
      } else if (myReg?.status === 'promoted') {
        actionState = 'promoted'
      } else if (myReg?.status === 'confirmed') {
        actionState = 'confirmed'
      } else if (myReg?.status === 'waitlist') {
        actionState = 'waitlist'
      } else if (myReg?.status === 'excused') {
        actionState = 'excused'
      } else if (notRegistered && isR1 && myTier !== 1 && isPerSession) {
        actionState = 'canWaitlist'
        waitlistBtnText = `加入候补 — R1 年卡优先 (${confirmedCount}/${match.maxPlayers})`
      } else if (notRegistered && isR1 && myTier !== 1) {
        actionState = 'r1Blocked'
      } else if (notRegistered && isOpen && !isFull && !hasPriorityWaiters) {
        actionState = 'canRegister'
      } else if (notRegistered && isOpen) {
        actionState = 'canWaitlist'
        waitlistBtnText = isFull
          ? `加入候补 — 名额已满 (${confirmedCount}/${match.maxPlayers})`
          : `加入候补 — 前方有优先候补 (${confirmedCount}/${match.maxPlayers})`
      } else {
        actionState = 'closed'
      }

      // Bring-a-friend: annual members (or admins) with an active own registration
      const canBringFriend = isOpen
        && (isAdmin || user?.membershipType === 'annual')
        && !!myReg && ['confirmed', 'promoted'].includes(myReg.status)

      // Upcoming phase times (R2 opens kickoff-8h, roster locks kickoff-1h)
      const lockD = new Date(match.date - 60 * 60 * 1000)
      const lockTime = `${String(lockD.getHours()).padStart(2, '0')}:${String(lockD.getMinutes()).padStart(2, '0')}`
      let scheduleLine1 = ''
      let scheduleLine2 = ''
      if (match.status === 'draft' || isR1) {
        scheduleLine1 = `R2 全员报名：${formatDate(match.date - 8 * 60 * 60 * 1000)} 开放`
        scheduleLine2 = `名单锁定：开球前 1 小时（${lockTime}）`
      } else if (match.status === 'registration_r2') {
        scheduleLine1 = `名单锁定：开球前 1 小时（${lockTime}）`
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
      const showScoreEditor = isAdmin && (match.status === 'ready' || match.status === 'completed')
      const hasScore = typeof match.scoreA === 'number' && typeof match.scoreB === 'number'

      // Captain picker team (drives the single-button captain UI)
      const captainPickerTeam: 'A' | 'B' | '' = isCaptainA ? 'A' : isCaptainB ? 'B' : ''
      // Whose turn it is in drafting
      const draftTurnTeam = (isDraftPhase && match.draftState?.currentTurn) || ''
      const draftTurnLabel = isDraftPhase
        ? (draftTurnTeam === 'A' ? '现在队长 A 选人' : draftTurnTeam === 'B' ? '现在队长 B 选人' : '选人完成')
        : ''
      // Hide team labels until drafting is fully complete (reveal moment), except for admins/captains.
      const draftComplete = match.status === 'ready' || match.status === 'completed'
      const showTeams = draftComplete || isAdmin || isCaptainA || isCaptainB
      if (!showTeams) {
        confirmedList.forEach(r => { r.teamLabel = '' })
      }

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
        myWaitRank,
        canBringFriend,
        waitlistBtnText,
        scheduleLine1,
        scheduleLine2,
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
        // The per-match agreement the player saw at signup wins; the config
        // default is only a fallback for matches created without one.
        agreementText: match.agreementText || agreementText || '报名即表示您同意遵守队伍规则并出席已报名的比赛。',
        isAdmin,
        banLeft,
        showDraft,
        showBehaviorTags,
        showAdminCaptain,
        showScoreEditor,
        hasScore,
        scoreAInput: hasScore ? String(match.scoreA) : '',
        scoreBInput: hasScore ? String(match.scoreB) : '',
        showTeams,
        captainPickerTeam,
        draftTurnTeam,
        draftTurnLabel,
        filteredRoster: confirmedList,
        posFilter: 'all',
        statsDirty: false,
      })
      this._changedStats.clear()

      this._startTimer(myReg)
      wx.nextTick(() => {
        this._generateShareImage().then((p: string) => { this._shareTempPath = p })
      })
    } catch (err) {
      console.error('loadMatch failed', err)
      this.setData({ loadError: true })
    } finally {
      this.setData({ loading: false })
    }
  },

  retryLoad() { this.loadMatch() },

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

  goHome() { wx.switchTab({ url: '/pages/home/index' }) },

  // catch handler for modal content taps — stops propagation to the overlay
  noop() {},

  goOnboard() {
    const app = getApp<{ globalData: { pendingRoute: string | null } }>()
    app.globalData.pendingRoute = `/pages/match-detail/index?id=${this.data.matchId}`
    wx.redirectTo({ url: '/pages/onboard/profile/index' })
  },

  openAgreementModal()  { this.setData({ showAgreementModal: true }) },
  closeAgreementModal() { this.setData({ showAgreementModal: false }) },
  openWaitlistModal()   { this.setData({ showWaitlistModal: true }) },
  closeWaitlistModal()  { this.setData({ showWaitlistModal: false }) },
  openRulesModal()      { this.setData({ showRulesModal: true }) },
  closeRulesModal()     { this.setData({ showRulesModal: false }) },
  openFriendModal()     { this.setData({ showFriendModal: true, friendName: '', friendPosMap: {} }) },
  closeFriendModal()    { this.setData({ showFriendModal: false }) },
  onFriendNameInput(e: WechatMiniprogram.Input) { this.setData({ friendName: e.detail.value }) },

  toggleFriendPos(e: WechatMiniprogram.BaseEvent) {
    const pos = (e.currentTarget.dataset as { pos: string }).pos
    const map = this.data.friendPosMap
    const selectedCount = ALL_POSITIONS.filter(p => map[p]).length
    if (!map[pos] && selectedCount >= 3) {
      wx.showToast({ title: '最多选 3 个位置', icon: 'none' })
      return
    }
    this.setData({ [`friendPosMap.${pos}`]: !map[pos] })
  },
  toggleAutoAccept()    { this.setData({ autoAccept: !this.data.autoAccept }) },

  async addFriend() {
    const name = this.data.friendName.trim()
    if (!name) { wx.showToast({ title: '请填写朋友称呼', icon: 'none' }); return }
    const friendPositions = ALL_POSITIONS.filter(p => this.data.friendPosMap[p])
    if (friendPositions.length === 0) {
      wx.showToast({ title: '请为朋友选至少一个位置', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'registerForMatch',
        data: { matchId: this.data.matchId, friendName: name, friendPositions },
      }) as unknown as { result: { status: string } }
      wx.showToast({ title: res.result.status === 'confirmed' ? '朋友已进名单' : '朋友已加入候补', icon: 'success' })
      this.setData({ showFriendModal: false })
      this.loadMatch()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg
        || (err as Error)?.message || '操作失败'
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async removeFriend(e: WechatMiniprogram.BaseEvent) {
    const { uid, name } = e.currentTarget.dataset as { uid: string; name: string }
    const res = await wx.showModal({ title: `移除 ${name}？`, content: '', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'withdrawFromMatch',
        data: { matchId: this.data.matchId, friendUid: uid },
      })
      wx.showToast({ title: '已移除', icon: 'success' })
      this.loadMatch()
    } catch {
      wx.showToast({ title: '操作失败', icon: 'error' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async bumpWait(e: WechatMiniprogram.BaseEvent) {
    const { uid, name } = e.currentTarget.dataset as { uid: string; name: string }
    const res = await wx.showModal({ title: `直接把 ${name} 提进名单？`, content: '', confirmColor: '#00C9A7' })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'updateMatchStatus',
        data: { action: 'bumpWaitlist', matchId: this.data.matchId, uid },
      })
      wx.showToast({ title: '已提升', icon: 'success' })
      this.loadMatch()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg
        || (err as Error)?.message || '操作失败'
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async register() {
    this.setData({ showAgreementModal: false, busy: true })
    try {
      try {
        await wx.requestSubscribeMessage({
          tmplIds: [SUBSCRIBE_TEMPLATES.promoted, SUBSCRIBE_TEMPLATES.matchCancelled],
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
          tmplIds: [SUBSCRIBE_TEMPLATES.promoted, SUBSCRIBE_TEMPLATES.matchCancelled],
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
      await wx.cloud.callFunction({ name: 'withdrawFromMatch', data: { matchId: this.data.matchId, mode: 'withdraw' } })
      wx.showToast({ title: '已退出', icon: 'success' })
      this.loadMatch()
    } catch {
      wx.showToast({ title: '操作失败', icon: 'error' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async excuse() {
    const res = await wx.showModal({ title: '确认请假？', content: '请假后可随时重新报名', confirmColor: '#F0B429' })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({ name: 'withdrawFromMatch', data: { matchId: this.data.matchId, mode: 'excuse' } })
      wx.showToast({ title: '已请假', icon: 'success' })
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
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg
        || (err as Error)?.message || '操作失败'
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    }
  },

  async captainPick(e: WechatMiniprogram.BaseEvent) {
    const { uid } = e.currentTarget.dataset as { uid: string }
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'processDraftPick',
        data: { matchId: this.data.matchId, pickedUid: uid },
      })
      this.loadMatch()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg
        || (err as Error)?.message || '选人失败'
      wx.showModal({ title: '选人失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  onScoreAInput(e: WechatMiniprogram.Input) { this.setData({ scoreAInput: e.detail.value }) },
  onScoreBInput(e: WechatMiniprogram.Input) { this.setData({ scoreBInput: e.detail.value }) },

  async saveScore() {
    const scoreA = parseInt(this.data.scoreAInput, 10)
    const scoreB = parseInt(this.data.scoreBInput, 10)
    if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
      wx.showToast({ title: '请填写两队比分', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'updateMatchStatus',
        data: { action: 'setScore', matchId: this.data.matchId, scoreA, scoreB },
      })
      wx.showToast({ title: '比分已记录', icon: 'success' })
      this.loadMatch()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg
        || (err as Error)?.message || '操作失败'
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  // Steppers edit locally; nothing is sent until 保存 — avoids a full page
  // reload (and visible flash) on every tap.
  incStat(e: WechatMiniprogram.BaseEvent) {
    const { index, field, delta } = e.currentTarget.dataset as { index: number; field: 'goals' | 'assists'; delta: number }
    const item = this.data.confirmedList[index]
    if (!item) return
    const next = Math.max(0, (item[field] ?? 0) + Number(delta))
    this._changedStats.add(item.uid)
    this.setData({
      [`confirmedList[${index}].${field}`]: next,
      statsDirty: true,
    })
  },

  async saveStats() {
    const changed = this.data.confirmedList.filter(r => this._changedStats.has(r.uid))
    if (changed.length === 0) return
    this.setData({ busy: true })
    try {
      for (const r of changed) {
        await wx.cloud.callFunction({
          name: 'updateMatchStatus',
          data: { action: 'setStat', matchId: this.data.matchId, uid: r.uid, goals: r.goals, assists: r.assists },
        })
      }
      this._changedStats.clear()
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ statsDirty: false })
      this.loadMatch()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg
        || (err as Error)?.message || '保存失败'
      wx.showModal({ title: '保存失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async toggleTag(e: WechatMiniprogram.BaseEvent) {
    const { uid, tag } = e.currentTarget.dataset as { uid: string; tag: MatchTag }
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

  _generateShareImage(): Promise<string> {
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .select('#share-canvas')
        .fields({ node: true, size: true })
        .exec((res: any[]) => {
          if (!res[0]?.node) { resolve(''); return }
          const canvas = res[0].node
          const ctx = canvas.getContext('2d')
          const dpr = Math.min(wx.getSystemInfoSync().pixelRatio, 2)
          const W = 500, H = 400
          canvas.width = W * dpr
          canvas.height = H * dpr
          ctx.scale(dpr, dpr)

          const { match, confirmedCount } = this.data
          if (!match) { resolve(''); return }

          const d2 = new Date(match.date)
          const wds = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
          const dateLine = `${d2.getMonth() + 1}月${d2.getDate()}日  ${wds[d2.getDay()]}`
          const timeLine = `${d2.getHours().toString().padStart(2, '0')}:${d2.getMinutes().toString().padStart(2, '0')}`

          const SC: Record<string, string> = {
            registration_r1: '#00C9A7', registration_r2: '#00C9A7',
            drafting: '#F0B429', ready: '#3B82F6',
            completed: '#6B7280', cancelled: '#EF4444', draft: '#4B5563',
          }
          const SL: Record<string, string> = {
            registration_r1: '报名 R1 →', registration_r2: '报名 R2 →',
            drafting: '选人中', ready: '即将开踢', completed: '已结束',
            cancelled: '已取消', draft: '草稿',
          }
          const sc = SC[match.status] ?? '#6B7280'
          const sl = SL[match.status] ?? match.status

          // Background
          ctx.fillStyle = '#0B1A10'
          ctx.fillRect(0, 0, W, H)
          // Left accent
          ctx.fillStyle = '#00C9A7'
          ctx.fillRect(0, 0, 6, H)

          // Club name
          ctx.fillStyle = '#00C9A7'
          ctx.font = 'bold 15px sans-serif'
          ctx.fillText('JIUZHOU  ⚽', 26, 44)

          // Status badge (top-right)
          ctx.font = 'bold 14px sans-serif'
          const slW = ctx.measureText(sl).width + 28
          const slX = W - slW - 20
          ctx.fillStyle = sc + '30'
          roundRect(ctx, slX, 20, slW, 28, 14)
          ctx.fill()
          ctx.fillStyle = sc
          ctx.fillText(sl, slX + 14, 39)

          // Date
          ctx.fillStyle = '#E8F0EB'
          ctx.font = 'bold 38px sans-serif'
          ctx.fillText(dateLine, 26, 140)
          // Time
          ctx.fillStyle = '#00C9A7'
          ctx.font = 'bold 28px sans-serif'
          ctx.fillText(timeLine, 26, 183)
          // Location
          ctx.fillStyle = '#7A8FA6'
          ctx.font = '22px sans-serif'
          const loc = match.location.length > 20 ? match.location.slice(0, 19) + '…' : match.location
          ctx.fillText(loc, 26, 222)

          // Divider
          ctx.fillStyle = '#1A2E1C'
          ctx.fillRect(26, 244, W - 52, 1)

          // Player count
          const max = match.maxPlayers, count = confirmedCount
          ctx.fillStyle = '#E8F0EB'
          ctx.font = 'bold 24px sans-serif'
          const cntStr = `${count}`
          ctx.fillText(cntStr, 26, 288)
          ctx.fillStyle = '#7A8FA6'
          ctx.font = '22px sans-serif'
          ctx.fillText(` / ${max} 人已报名`, 26 + ctx.measureText(cntStr).width, 288)

          // Progress bar
          const bX = 26, bY = 302, bW = W - 52, bH = 10
          ctx.fillStyle = '#1A2E1C'
          roundRect(ctx, bX, bY, bW, bH, 5)
          ctx.fill()
          ctx.fillStyle = count >= max ? '#F0B429' : '#00C9A7'
          roundRect(ctx, bX, bY, Math.max(bW * Math.min(count / Math.max(max, 1), 1), 4), bH, 5)
          ctx.fill()

          // Footer
          ctx.fillStyle = '#253C27'
          ctx.font = '15px sans-serif'
          ctx.fillText('长按识别小程序码  立即报名', 26, H - 20)
          ctx.font = 'bold 15px sans-serif'
          ctx.textAlign = 'right'
          ctx.fillText('九州足球', W - 26, H - 20)
          ctx.textAlign = 'left'

          wx.canvasToTempFilePath({
            canvas,
            success: (r: any) => resolve(r.tempFilePath),
            fail: () => resolve(''),
          })
        })
    })
  },

  onShareAppMessage(): any {
    const { match, dateStr, matchId } = this.data
    if (!match) return { title: '九州比赛', path: '/pages/matches/index' }
    const base = {
      title: `${dateStr.split(' ').slice(0, 2).join(' ')} · ${match.location}`,
      path: `/pages/match-detail/index?id=${matchId}`,
    }
    if (this._shareTempPath) return { ...base, imageUrl: this._shareTempPath }
    // onShareAppMessage can't return a bare Promise — async results go in the
    // `promise` field (base library ≥ 2.12.0), with `base` as the sync fallback.
    return {
      ...base,
      promise: this._generateShareImage()
        .then((imageUrl: string) => imageUrl ? { ...base, imageUrl } : base)
        .catch(() => base),
    }
  },
})
