import type { Match, Registration, MatchTag } from '../../types/index'
import { formatDate, STATUS_LABEL, STATUS_BADGE, REG_STATUS_LABEL, markdownToHtml } from '../../utils/format'
import { bankAdminSubscribe } from '../../utils/subscribe'
import { ADMIN_CONTACT } from '../../utils/contact'

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
  matchOpen: 'P7F5ctAq206UpDYL747jHSEKa-7jMC8SjwFztxsgx5w',
}

// wx.requestSubscribeMessage allows at most 3 templates per call
const MEMBER_TMPL_IDS = [
  SUBSCRIBE_TEMPLATES.promoted,
  SUBSCRIBE_TEMPLATES.matchCancelled,
  SUBSCRIBE_TEMPLATES.matchOpen,
]

const POS_GROUPS = [
  { key: 'all', label: '全部', positions: [] as string[] },
  { key: 'GK',  label: 'GK',  positions: ['GK'] },
  { key: 'DEF', label: 'DEF', positions: ['CB', 'LB', 'RB'] },
  { key: 'MID', label: 'MID', positions: ['CDM', 'CM', 'CAM'] },
  { key: 'FWD', label: 'FWD', positions: ['LW', 'RW', 'ST'] },
]

const ALL_POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']

// Position-group color class + GK→DEF→MID→FWD sort rank
const POS_GROUP_CLS: Record<string, string> = {
  GK: 'pos-gk',
  CB: 'pos-def', LB: 'pos-def', RB: 'pos-def',
  CDM: 'pos-mid', CM: 'pos-mid', CAM: 'pos-mid',
  LW: 'pos-fwd', RW: 'pos-fwd', ST: 'pos-fwd',
}
const POS_GROUP_RANK: Record<string, number> = {
  GK: 0, CB: 1, LB: 1, RB: 1, CDM: 2, CM: 2, CAM: 2, LW: 3, RW: 3, ST: 3,
}
function groupRank(r: Registration): number {
  return POS_GROUP_RANK[(r.preferredPositions ?? [])[0] ?? ''] ?? 4
}

// Cloud-function errors arrive wrapped in CloudBase stack noise — pull out
// the human message ("errMsg: Error: <text> at ...") or fall back.
function errText(err: unknown, fallback: string): string {
  const raw = (err as { errMsg?: string; message?: string })?.errMsg
    || (err as Error)?.message || ''
  const m = raw.match(/errMsg:\s*Error:\s*([^]+?)(?:\s+at\s|$)/)
  const text = (m ? m[1] : raw).trim()
  return text && text.length <= 60 ? text : fallback
}

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
  isGk: boolean
  posTags: Array<{ pos: string; cls: string }>
}

type ActionState = 'cancelled' | 'promoted' | 'confirmed' | 'waitlist' | 'excused' | 'canRegister' | 'canWaitlist' | 'r1Blocked' | 'banned' | 'needProfile' | 'needMembership' | 'closed' | 'loading'

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
    showStats: false,
    showTacticsBtn: false,
    captainTips: '',
    draftNudgeText: '',
    needAssignAlert: '',
    showTeams: false,
    hasScore: false,
    scoreManual: false,
    isCasual: false,
    scoreAInput: '',
    scoreBInput: '',
    banLeft: 0,
    lateWarning: '',
    gkList: [] as Array<{ uid: string; displayName: string }>,
    lateOver: false,
    myLate: 0,
    lateThreshold: 0,
    loadError: false,
    canBringFriend: false,
    canStartDraft: false,
    myWaitRank: 0,
    waitlistBtnText: '',
    scheduleLine1: '',
    scheduleLine2: '',
    scheduleLine3: '',
    showFriendModal: false,
    friendName: '',
    allPositions: ALL_POSITIONS,
    friendPosMap: {} as Record<string, boolean>,
    showProxyModal: false,
    proxySearch: '',
    proxyList: [] as Array<{ uid: string; displayName: string; membershipLabel: string }>,
    proxyLoading: false,
    canProxy: false,
    showRulesModal: false,
    showPopupAnn: false,
    popupAnnTitle: '',
    popupAnnHtml: '',
    statsDirty: false,
    adminContact: ADMIN_CONTACT,
    captainPickerTeam: '' as 'A' | 'B' | '',
    draftTurnLabel: '',
  },

  _timerInterval: null as ReturnType<typeof setInterval> | null,
  _draftPoll: null as ReturnType<typeof setInterval> | null,
  _loading: false,
  _lastSig: '',
  _popupShown: false,
  _registrations: [] as Registration[],
  _confirmedListRaw: [] as RegVM[],
  _shareTempPath: '' as string,
  _changedStats: new Set<string>(),
  _allMembers: [] as Array<{ _id: string; displayName: string; membershipType: string }>,

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

  onHide() {
    this._stopDraftPoll()
  },

  onUnload() {
    if (this._timerInterval) clearInterval(this._timerInterval)
    this._stopDraftPoll()
  },

  // Free-for-all drafting: the other captain's picks don't push to this page,
  // so poll silently while the draft is live to keep the lists current.
  _startDraftPoll() {
    if (this._draftPoll) return
    this._draftPoll = setInterval(() => this.loadMatch(true), 4000)
  },
  _stopDraftPoll() {
    if (this._draftPoll) { clearInterval(this._draftPoll); this._draftPoll = null }
  },

  async loadMatch(silent = false) {
    if (!this.data.matchId || this._loading) return
    this._loading = true
    if (!silent) this.setData({ loading: true, loadError: false })
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
          lateThreshold: number
          popupAnn: { id: string; title: string; content: string } | null
          callerInfo: { membershipType: string; role: string; banGamesLeft: number; lateCount: number } | null
        }
      }

      const { match, registrations, agreementText, callerInfo, lateThreshold, popupAnn } = cfRes.result

      // Silent polls: skip rendering entirely when nothing changed — a full
      // setData re-render can shift the scroll position mid-draft.
      const sig = JSON.stringify({
        s: match.status, sa: match.scoreA, sb: match.scoreB,
        ca: match.captainA, cb: match.captainB, n: match.draftNudge?.at ?? 0,
        r: registrations.map(r => [r.uid, r.status, r.team, r.waitlistPosition, r.goals, r.assists, r.tags]),
      })
      if (silent && sig === this._lastSig) return
      this._lastSig = sig

      this._registrations = registrations

      // Overlay the server's fresh identity on the login-time snapshot, so a
      // membership change by an admin takes effect without an app restart.
      let user = app.globalData.userProfile
      if (user && callerInfo) {
        user = { ...user, ...callerInfo } as typeof user
        app.globalData.userProfile = user
      }

      // Popup announcement: once per page open, never during silent polls
      if (popupAnn && !silent && !this._popupShown) {
        this._popupShown = true
        this.setData({
          popupAnnTitle: popupAnn.title,
          popupAnnHtml: markdownToHtml(popupAnn.content || ''),
          showPopupAnn: true,
        })
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
        // Guests: their bringer or an admin; anyone else: admin only (代报清理)
        canRemove: r.isGuest
          ? (isAdmin || r.broughtBy === user?._id)
          : (isAdmin && r.uid !== user?._id),
        // Only the primary position gets the group color — backups stay grey
        isGk: !!r.gkPenalty,
        posTags: (r.preferredPositions ?? []).map((pos, i) => ({
          pos,
          cls: i === 0 ? (POS_GROUP_CLS[pos] ?? 'pos-chip-secondary') : 'pos-chip-secondary',
        })),
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
      // 'ready' covers a full roster and a finished draft alike — the waitlist
      // stays joinable for replacements until the kickoff-1h hard lock.
      const waitlistOpen = isOpen || (match.status === 'ready' && match.rosterLocked !== true)
      // Match-day 14:00 cutoff: afterwards signups queue for captain/admin review
      const kd = new Date(match.date)
      const cutoffMs = new Date(kd.getFullYear(), kd.getMonth(), kd.getDate(), 14, 0, 0).getTime()
      const postCutoff = waitlistOpen && Date.now() >= cutoffMs
      const isR1 = match.status === 'registration_r1'
      const myTier = isAdmin || user?.membershipType === 'annual' ? 1 : 3
      const isPerSession = user?.membershipType === 'per_session'
      // Someone with equal/higher priority already waiting → no queue jumping
      const hasPriorityWaiters = waitlistList.some(r => (r.waitlistTier ?? 1) <= myTier)
      const notRegistered = !myReg || myReg.status === 'withdrawn' || myReg.status === 'excused'
      const banLeft = user?.banGamesLeft ?? 0
      // Late tally at/over threshold → GK duty for the next match played
      const myLate = callerInfo?.lateCount ?? 0
      const lateOver = lateThreshold > 0 && myLate >= lateThreshold
      const lateWarning = lateOver
        ? (myReg?.gkPenalty
            ? `你已累计迟到 ${myLate} 次，本场需要担任半场门将。赛后请提醒队长或管理员帮你清零记录`
            : `你已累计迟到 ${myLate} 次，报名下一场时需要担任半场门将`)
        : ''

      let actionState: ActionState = 'loading'
      let waitlistBtnText = ''
      if (!user) {
        // New visitor from a shared link who hasn't completed onboarding —
        // give them an explicit path in instead of a dead "报名已关闭".
        actionState = waitlistOpen ? 'needProfile' : 'closed'
      } else if (match.status === 'cancelled') {
        actionState = 'cancelled'
      } else if (notRegistered && waitlistOpen && banLeft > 0) {
        actionState = 'banned'
      } else if (notRegistered && waitlistOpen && !isAdmin
        && user.membershipType !== 'annual' && user.membershipType !== 'per_session') {
        // Unvetted visitor (shared link) — must get membership first
        actionState = 'needMembership'
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
      } else if (notRegistered && waitlistOpen && postCutoff) {
        actionState = 'canWaitlist'
        waitlistBtnText = `加入候补 — 14:00 后需审核补入 (${confirmedCount}/${match.maxPlayers})`
      } else if (notRegistered && isOpen && !isFull && !hasPriorityWaiters) {
        actionState = 'canRegister'
      } else if (notRegistered && waitlistOpen) {
        actionState = 'canWaitlist'
        waitlistBtnText = isFull
          ? `加入候补 — 名额已满 (${confirmedCount}/${match.maxPlayers})`
          : `加入候补 — 前方有优先候补 (${confirmedCount}/${match.maxPlayers})`
      } else {
        actionState = 'closed'
      }

      // Bring-a-friend: annual members (or admins) with an active own registration
      const canBringFriend = waitlistOpen
        && (isAdmin || user?.membershipType === 'annual')
        && !!myReg && ['confirmed', 'promoted'].includes(myReg.status)

      // Captains (or admins) can kick off drafting once both captains are set
      const canStartDraft = isOpen
        && !!match.captainA && !!match.captainB
        && (isAdmin || isCaptainA || isCaptainB)

      // Admin proxy registration (代报, uncapped) while signup/waitlist is open
      const canProxy = isAdmin && waitlistOpen

      // Upcoming phase times (R2 opens kickoff-8h, roster locks kickoff-1h)
      const lockD = new Date(match.date - 60 * 60 * 1000)
      const lockTime = `${String(lockD.getHours()).padStart(2, '0')}:${String(lockD.getMinutes()).padStart(2, '0')}`
      let scheduleLine1 = ''
      let scheduleLine2 = ''
      let scheduleLine3 = ''
      if (match.status === 'draft' || isR1) {
        scheduleLine1 = `R2 全员报名：${formatDate(match.date - 8 * 60 * 60 * 1000)} 开放`
        scheduleLine2 = `名单锁定：开球前 1 小时（${lockTime}）`
      } else if (match.status === 'registration_r2') {
        scheduleLine1 = `名单锁定：开球前 1 小时（${lockTime}）`
      }
      if (waitlistOpen && !postCutoff) {
        scheduleLine3 = '比赛日 14:00 报名截止，此后候补需队长/管理员审核补入'
      }

      // Draft views sort GK → DEF → MID → FWD (stable within a group);
      // the roster list keeps signup order — 第 N 位 depends on it.
      const byPosGroup = (a: RegVM, b: RegVM) => groupRank(a) - groupRank(b)
      const unassignedList = confirmedList.filter(r => !r.team).sort(byPosGroup)
      const teamAList = confirmedList.filter(r => r.team === 'A').sort(byPosGroup)
      const teamBList = confirmedList.filter(r => r.team === 'B').sort(byPosGroup)

      const captainAName = registrations.find(r => r.uid === match.captainA)?.displayName ?? ''
      const captainBName = registrations.find(r => r.uid === match.captainB)?.displayName ?? ''
      const captainAIndex = confirmedList.findIndex(r => r.uid === match.captainA)
      const captainBIndex = confirmedList.findIndex(r => r.uid === match.captainB)

      const isDraftPhase = match.status === 'drafting'
      const isCaptain = isCaptainA || isCaptainB
      const isDone = match.status === 'ready' || match.status === 'completed'
      // Assignment UI stays available in 'ready' so late replacements can be
      // slotted onto a team without reopening the draft.
      const canAssign = (isAdmin || isCaptain) && !!match.captainA && !!match.captainB
      const showDraft = canAssign && (isDraftPhase || match.status === 'ready')
      // Behavior tags (迟到/危险/缺席 → bans) stay admin-only; score and
      // goals/assists are open to this match's captains too.
      const showBehaviorTags = isAdmin && isDone && confirmedCount > 0
      const showAdminCaptain = isAdmin && confirmedCount > 0
      const showScoreEditor = (isAdmin || isCaptain) && isDone
      const showStats = (isAdmin || isCaptain) && isDone && confirmedCount > 0
      const hasScore = typeof match.scoreA === 'number' && typeof match.scoreB === 'number'
      const scoreManual = match.scoreManual === true
      const isCasual = match.casual === true

      // Players still owing a GK half — captains/admins clear these manually
      const gkList = (isAdmin || isCaptain)
        ? confirmedList.filter(r => r.gkPenalty).map(r => ({ uid: r.uid, displayName: r.displayName }))
        : []

      // Jump to the tactics board once teams exist (players on a team see
      // theirs; captains can pre-plan during drafting)
      const showTacticsBtn = (isDone && (!!myReg?.team || isCaptain || isAdmin))
        || (isDraftPhase && isCaptain)

      // Stage-aware guide for captains
      let captainTips = ''
      if (isCaptain) {
        if (isOpen) captainTips = '你是本场队长：人齐后点「开始选人」，选人不分先后、先到先得'
        else if (isDraftPhase) captainTips = '点「选 → 你的队」选人，选错点 ↩ 退回；带 🧤 的球员因累计迟到需当半场门将，每场最多 2 人；选完一批点「我选完了」提醒对方；双方都选好后点「选人结束」'
        else if (isDone) captainTips = '选人完成：去战术板排阵；有人请假时递补的球员会自动顶替他的队伍，若显示未分队请在下方安排；赛后记录比分和进球/助攻'
      }

      // Opponent captain's "your turn" nudge (shown to the nudged captain only)
      const nudge = match.draftNudge
      const draftNudgeText = isDraftPhase && nudge
        && nudge.to === (isCaptainA ? 'A' : isCaptainB ? 'B' : '')
        && Date.now() - nudge.at < 10 * 60 * 1000
        ? `📣 队长${nudge.from}提醒：该你选人了`
        : ''

      // Captain picker team (drives the single-button captain UI)
      const captainPickerTeam: 'A' | 'B' | '' = isCaptainA ? 'A' : isCaptainB ? 'B' : ''
      // Free-for-all drafting: both captains pick anytime, first tap wins
      const draftTurnLabel = isDraftPhase ? '自由选人 · 先到先得' : (showDraft ? '补位分队' : '')
      // Someone came off the waitlist after the draft and has no team yet
      const unassignedCount = confirmedList.filter(r => !r.team).length
      const needAssignAlert = match.status === 'ready' && unassignedCount > 0
        ? `有 ${unassignedCount} 人递补进名单还没分队，请队长/管理员在下方安排`
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
        canStartDraft,
        canProxy,
        waitlistBtnText,
        scheduleLine1,
        scheduleLine2,
        scheduleLine3,
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
        lateWarning,
        gkList,
        lateOver,
        myLate,
        lateThreshold,
        showDraft,
        showBehaviorTags,
        showAdminCaptain,
        showScoreEditor,
        showStats,
        showTacticsBtn,
        captainTips,
        draftNudgeText,
        needAssignAlert,
        hasScore,
        scoreManual,
        isCasual,
        scoreAInput: hasScore ? String(match.scoreA) : '',
        scoreBInput: hasScore ? String(match.scoreB) : '',
        showTeams,
        captainPickerTeam,
        draftTurnLabel,
        filteredRoster: confirmedList,
        posFilter: 'all',
        statsDirty: false,
      })
      this._changedStats.clear()

      this._startTimer(myReg)
      if (showDraft) this._startDraftPoll()
      else this._stopDraftPoll()
      if (!silent) {
        wx.nextTick(() => {
          this._generateShareImage().then((p: string) => { this._shareTempPath = p })
        })
      }
    } catch (err) {
      console.error('loadMatch failed', err)
      if (!silent) this.setData({ loadError: true })
    } finally {
      this._loading = false
      if (!silent) this.setData({ loading: false })
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

  goTactics() { wx.switchTab({ url: '/pages/tactics/index' }) },


  // catch handler for modal content taps — stops propagation to the overlay
  noop() {},

  goOnboard() {
    const app = getApp<{ globalData: { pendingRoute: string | null } }>()
    app.globalData.pendingRoute = `/pages/match-detail/index?id=${this.data.matchId}`
    wx.redirectTo({ url: '/pages/onboard/profile/index' })
  },

  goApplyMembership() {
    wx.switchTab({ url: '/pages/profile/index' })
  },

  openAgreementModal()  { this.setData({ showAgreementModal: true }) },
  closeAgreementModal() { this.setData({ showAgreementModal: false }) },
  openWaitlistModal()   { this.setData({ showWaitlistModal: true }) },
  closeWaitlistModal()  { this.setData({ showWaitlistModal: false }) },
  closePopupAnn()       { this.setData({ showPopupAnn: false }) },
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
      const msg = errText(err, '操作失败')
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async removePlayer(e: WechatMiniprogram.BaseEvent) {
    const { uid, name, isguest } = e.currentTarget.dataset as { uid: string; name: string; isguest: boolean }
    const res = await wx.showModal({ title: `移除 ${name}？`, content: '空出的名额将自动递补', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'withdrawFromMatch',
        data: isguest
          ? { matchId: this.data.matchId, friendUid: uid }
          : { matchId: this.data.matchId, targetUid: uid },
      })
      wx.showToast({ title: '已移除', icon: 'success' })
      this.loadMatch()
    } catch {
      wx.showToast({ title: '操作失败', icon: 'error' })
    } finally {
      this.setData({ busy: false })
    }
  },

  // ── admin proxy registration (代报) ─────────────────────────────────
  async openProxyModal() {
    this.setData({ showProxyModal: true, proxySearch: '', proxyLoading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'adminGetMembers' }) as unknown as {
        result: { members: Array<{ _id: string; displayName: string; membershipType: string }> }
      }
      this._allMembers = res.result.members
    } catch {
      wx.showToast({ title: '成员加载失败', icon: 'error' })
    } finally {
      this.setData({ proxyLoading: false })
      this._refreshProxyList()
    }
  },
  closeProxyModal() { this.setData({ showProxyModal: false }) },
  onProxySearch(e: WechatMiniprogram.Input) {
    this.setData({ proxySearch: e.detail.value })
    this._refreshProxyList()
  },

  _refreshProxyList() {
    const MEMBERSHIP_LABEL: Record<string, string> = { annual: '年卡', per_session: '次卡', none: '未激活' }
    const activeUids = new Set(
      this._registrations
        .filter((r: Registration) => r.status !== 'withdrawn')
        .map((r: Registration) => r.uid),
    )
    const kw = this.data.proxySearch.trim().toLowerCase()
    const proxyList = this._allMembers
      .filter(m => !activeUids.has(m._id))
      .filter(m => !kw || (m.displayName ?? '').toLowerCase().includes(kw))
      .slice(0, 50)
      .map(m => ({
        uid: m._id,
        displayName: m.displayName,
        membershipLabel: MEMBERSHIP_LABEL[m.membershipType] ?? m.membershipType,
      }))
    this.setData({ proxyList })
  },

  async proxyRegister(e: WechatMiniprogram.BaseEvent) {
    const { uid, name } = e.currentTarget.dataset as { uid: string; name: string }
    this.setData({ busy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'registerForMatch',
        data: { matchId: this.data.matchId, forUid: uid },
      }) as unknown as { result: { status: string } }
      wx.showToast({
        title: res.result.status === 'waitlist' ? `${name} 已入候补` : `${name} 已报名`,
        icon: 'success',
      })
      await this.loadMatch()
      this._refreshProxyList()
    } catch (err: unknown) {
      const msg = errText(err, '操作失败')
      wx.showModal({ title: '代报失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async bumpWait(e: WechatMiniprogram.BaseEvent) {
    bankAdminSubscribe()
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
      const msg = errText(err, '操作失败')
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async register() {
    this.setData({ showAgreementModal: false })
    // Late tally over threshold: this match must be played in goal
    if (this.data.lateOver) {
      const gk = await wx.showModal({
        title: '本场需要担任半场门将',
        content: `你已累计迟到 ${this.data.myLate} 次（阈值 ${this.data.lateThreshold} 次），本场需要担任半场门将。完成后请提醒队长或管理员帮你清零记录。确认报名吗？`,
        confirmText: '接受并报名',
        confirmColor: '#F0B429',
      })
      if (!gk.confirm) return
    }
    // Slot #23 is at risk: warn before committing
    if (this.data.confirmedCount === 22) {
      const warn = await wx.showModal({
        title: '你将是第 23 位报名',
        content: '若比赛日 14:00 前未满 24 人，你将转为候补第一位（保证 22 人双数开赛）；满 24 人则正常出战。确定报名吗？',
        confirmColor: '#F0B429',
      })
      if (!warn.confirm) return
    }
    this.setData({ busy: true })
    try {
      try {
        await wx.requestSubscribeMessage({ tmplIds: MEMBER_TMPL_IDS })
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
        await wx.requestSubscribeMessage({ tmplIds: MEMBER_TMPL_IDS })
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
      try {
        await wx.requestSubscribeMessage({ tmplIds: MEMBER_TMPL_IDS })
      } catch (_) {}
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
    // R2 onward it's close to kickoff — nudge people to announce in the group
    const lateExcuse = this.data.match?.status !== 'registration_r1'
    const res = await wx.showModal({
      title: '确认请假？',
      content: lateExcuse
        ? '已进入 R2 阶段，请假后请务必在微信群里说一声，方便队友补位'
        : '请假后可随时重新报名',
      confirmColor: '#F0B429',
    })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({ name: 'withdrawFromMatch', data: { matchId: this.data.matchId, mode: 'excuse' } })
      if (lateExcuse) {
        wx.showModal({ title: '已请假', content: '记得在微信群里告知大家 🙏', showCancel: false, confirmText: '知道了' })
      } else {
        wx.showToast({ title: '已请假', icon: 'success' })
      }
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
      this.loadMatch(true)
    } catch (err: unknown) {
      const msg = errText(err, '操作失败')
      this.loadMatch(true)
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    }
  },

  async nudgeOpponent() {
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'processDraftPick',
        data: { matchId: this.data.matchId, nudge: true },
      })
      wx.showToast({ title: '已提醒对方队长', icon: 'success' })
    } catch (err: unknown) {
      wx.showToast({ title: errText(err, '提醒失败'), icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async endDraft() {
    const remaining = this.data.unassignedList.length
    const res = await wx.showModal({
      title: '结束选人？',
      content: remaining > 0
        ? `还有 ${remaining} 人未分配队伍，确定结束吗？`
        : '双方都选好了吗？结束后进入「已就绪」，可去战术板排阵',
      confirmColor: '#00C9A7',
    })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'updateMatchStatus',
        data: { matchId: this.data.matchId, status: 'ready' },
      })
      wx.showToast({ title: '选人结束', icon: 'success' })
      this.loadMatch()
    } catch (err: unknown) {
      wx.showModal({ title: '操作失败', content: errText(err, '操作失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async startDraft() {
    const res = await wx.showModal({
      title: '开始选人？',
      content: '开始后报名暂停，两位队长自由选人',
      confirmColor: '#F0B429',
    })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'updateMatchStatus',
        data: { matchId: this.data.matchId, status: 'drafting' },
      })
      wx.showToast({ title: '选人开始', icon: 'success' })
      this.loadMatch()
    } catch (err: unknown) {
      const msg = errText(err, '操作失败')
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
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
      this.loadMatch(true)
    } catch (err: unknown) {
      const msg = errText(err, '选人失败')
      // Most failures mean the lists went stale (the other captain acted) —
      // refresh immediately so the next tap works.
      this.loadMatch(true)
      wx.showModal({ title: '选人失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  onScoreAInput(e: WechatMiniprogram.Input) { this.setData({ scoreAInput: e.detail.value }) },
  onScoreBInput(e: WechatMiniprogram.Input) { this.setData({ scoreBInput: e.detail.value }) },

  async clearLate(e: WechatMiniprogram.BaseEvent) {
    const { uid, name } = e.currentTarget.dataset as { uid: string; name: string }
    const res = await wx.showModal({
      title: `确认 ${name} 已当半场门将？`,
      content: '确认后其迟到记录清零，本人和管理员都会收到通知',
      confirmColor: '#00C9A7',
    })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'updateMatchStatus',
        data: { action: 'clearLatePenalty', matchId: this.data.matchId, uid },
      })
      wx.showToast({ title: '已清零', icon: 'success' })
      this.loadMatch()
    } catch (err: unknown) {
      wx.showModal({ title: '操作失败', content: errText(err, '操作失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async toggleCasual() {
    const turningOn = !this.data.isCasual
    const res = await wx.showModal({
      title: turningOn ? '标记为娱乐局？' : '取消娱乐局标记？',
      content: turningOn
        ? '本场不显示比分，也不计入队长积分榜（进球/助攻照常统计）'
        : '本场恢复显示比分并计入队长积分榜',
      confirmColor: '#F0B429',
    })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'updateMatchStatus',
        data: { action: 'toggleCasual', matchId: this.data.matchId, casual: turningOn },
      })
      wx.showToast({ title: turningOn ? '已设为娱乐局' : '已取消', icon: 'success' })
      this.loadMatch()
    } catch (err: unknown) {
      wx.showModal({ title: '操作失败', content: errText(err, '操作失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async autoScore() {
    const res = await wx.showModal({
      title: '改回自动计算？',
      content: '比分将按每人进球记录自动汇总，之后录入进球会同步更新比分',
      confirmColor: '#00C9A7',
    })
    if (!res.confirm) return
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'updateMatchStatus',
        data: { action: 'autoScore', matchId: this.data.matchId },
      })
      wx.showToast({ title: '已改回自动', icon: 'success' })
      this.loadMatch()
    } catch (err: unknown) {
      wx.showModal({ title: '操作失败', content: errText(err, '操作失败'), showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async saveScore() {
    bankAdminSubscribe()
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
      const msg = errText(err, '操作失败')
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
      const msg = errText(err, '保存失败')
      wx.showModal({ title: '保存失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async unpick(e: WechatMiniprogram.BaseEvent) {
    const { uid } = e.currentTarget.dataset as { uid: string }
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'processDraftPick',
        data: { matchId: this.data.matchId, unpickUid: uid },
      })
      this.loadMatch(true)
    } catch (err: unknown) {
      const msg = errText(err, '操作失败')
      this.loadMatch(true)
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async toggleTag(e: WechatMiniprogram.BaseEvent) {
    bankAdminSubscribe()
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
