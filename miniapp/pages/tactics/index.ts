import type { Match, Registration } from '../../types/index'

interface PitchPlayer {
  uid: string
  name: string
  initial: string
  position: string
  x: number
  y: number
  team: 'A' | 'B'
  isMe: boolean
}

// Default slot positions [xFrac, yFrac] within own team's half.
// Caller renders the pitch with own team on the bottom half, so we use
// y-fractions in [0.55, 0.95] for everyone — single set of slots.
const SLOTS: [number, number][] = [
  [0.5, 0.95],
  [0.15, 0.83], [0.38, 0.83], [0.62, 0.83], [0.85, 0.83],
  [0.2, 0.71], [0.5, 0.73], [0.8, 0.71],
  [0.2, 0.59], [0.5, 0.61], [0.8, 0.59],
]

type VisibilityState = 'loading' | 'no-match' | 'not-yet' | 'no-team' | 'ok'

Page({
  data: {
    players: [] as PitchPlayer[],
    pitchWidth: 0,
    pitchHeight: 0,
    tokenPx: 40,
    halfwayY: 0,
    circleX: 0, circleY: 0, circleDiam: 0,
    penH: 0, penW: 0, penX: 0,
    goalW: 0, goalX: 0, goalH: 0,
    dotX: 0, dotTopY: 0, dotBotY: 0,
    matchId: '',
    matchTitle: '',
    callerTeam: '' as 'A' | 'B' | '',
    isCaptain: false,
    canEdit: false,
    dualView: false,
    state: 'loading' as VisibilityState,
    lockMessage: '',
  },

  onLoad() {
    const sys = wx.getSystemInfoSync()
    const pw = sys.windowWidth - 32
    const ph = Math.round(pw * 1.6)
    const tokenPx = Math.round(pw * 0.085)

    const circleR = Math.round(pw * 0.12)
    const penW = Math.round(pw * 0.60)
    const penX = Math.round((pw - penW) / 2)
    const penH = Math.round(ph * 0.17)
    const goalW = Math.round(pw * 0.28)
    const goalX = Math.round((pw - goalW) / 2)
    const goalH = Math.round(ph * 0.07)
    const dotX = Math.round(pw / 2 - 5)
    const dotTopY = Math.round(ph * 0.13)
    const dotBotY = Math.round(ph * 0.87)

    this.setData({
      pitchWidth: pw, pitchHeight: ph, tokenPx,
      halfwayY: Math.round(ph / 2),
      circleX: Math.round(pw / 2 - circleR), circleY: Math.round(ph / 2 - circleR), circleDiam: circleR * 2,
      penH, penW, penX,
      goalW, goalX, goalH,
      dotX, dotTopY, dotBotY,
    })
  },

  onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    this.loadData()
  },

  onShareAppMessage() {
    return { title: '九州战术板', path: '/pages/home/index' }
  },

  async loadData() {
    this.setData({ state: 'loading' })
    try {
      const app = getApp<{
        globalData: { userProfile: { _id: string; role: string } | null }
        loginReady?: Promise<void>
      }>()
      // Cold start: wait for autoLogin, otherwise a logged-in user is told
      // there's no match when one exists.
      await (app.loginReady ?? Promise.resolve()).catch(() => {})
      const user = app.globalData.userProfile
      if (!user) { this.setData({ state: 'no-match' }); return }

      const annRes = await wx.cloud.callFunction({ name: 'getAnnouncements' }) as unknown as {
        result: { nextMatch: (Match & { id: string }) | null }
      }
      const nextMatch = annRes.result.nextMatch
      if (!nextMatch) { this.setData({ state: 'no-match' }); return }

      const detailRes = await wx.cloud.callFunction({
        name: 'getMatchDetail',
        data: { matchId: nextMatch.id },
      }) as unknown as {
        result: {
          match: Match & { id: string }
          registrations: (Registration & { uid: string })[]
          formation: { team: 'A' | 'B' | null; positions: Record<string, { x: number; y: number }> | { A: Record<string, { x: number; y: number }>; B: Record<string, { x: number; y: number }> } } | null
          callerTeam: 'A' | 'B' | null
        }
      }

      const { match, registrations, formation, callerTeam } = detailRes.result
      const isCaptainA = !!match.captainA && user._id === match.captainA
      const isCaptainB = !!match.captainB && user._id === match.captainB
      const isCaptain = isCaptainA || isCaptainB

      // Visibility rules
      // status === 'drafting' → only captains see (their own team)
      // status === 'ready' or 'completed' → all team members see their own team
      // earlier statuses → locked
      const draftComplete = match.status === 'ready' || match.status === 'completed'
      const draftingNow = match.status === 'drafting'

      // Captains can always see the board (to pre-plan/draft).
      // Non-captains see only after drafting is fully complete.
      if (!isCaptain && !draftComplete) {
        this.setData({
          state: 'not-yet',
          lockMessage: draftingNow ? '选人进行中，战术将在选人结束后揭晓' : '战术板将在选人完成后开放',
          matchId: match.id,
          matchTitle: `${new Date(match.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${match.location}`,
        })
        return
      }

      // Dual "full pitch" view — the server only sends both boards to the
      // tacticsAll-flagged owner when they're on neither team. Team A renders
      // as saved (bottom half); Team B is mirrored to the top half so the two
      // formations face each other. Read-only.
      const dualPositions = formation && formation.team === null
        && formation.positions && ('A' in (formation.positions as object))
        ? (formation.positions as {
            A: Record<string, { x: number; y: number }>
            B: Record<string, { x: number; y: number }>
          })
        : null
      if (dualPositions) {
        const { pitchWidth: pw, pitchHeight: ph, tokenPx } = this.data
        const half = Math.round(tokenPx / 2)
        const activeRegs = registrations.filter(r => r.status === 'confirmed' || r.status === 'promoted')
        const mk = (r: Registration & { uid: string }, i: number, team: 'A' | 'B'): PitchPlayer => {
          const saved = (team === 'A' ? dualPositions.A : dualPositions.B)?.[r.uid]
          const slot = SLOTS[i] ?? [0.5, 0.75]
          let x = saved ? saved.x * pw : slot[0] * pw - half
          let y = saved ? saved.y * ph : slot[1] * ph - half
          if (team === 'B') { x = pw - tokenPx - x; y = ph - tokenPx - y }
          const name = (r.displayName ?? '?').trim()
          return {
            uid: r.uid,
            name,
            initial: name.charAt(0).toUpperCase() || '?',
            position: (r.preferredPositions ?? [])[0] ?? '',
            team,
            x: Math.round(x),
            y: Math.round(y),
            isMe: false,
          }
        }
        const players: PitchPlayer[] = [
          ...activeRegs.filter(r => r.team === 'A').map((r, i) => mk(r, i, 'A')),
          ...activeRegs.filter(r => r.team === 'B').map((r, i) => mk(r, i, 'B')),
        ]
        const dualDateStr = new Date(match.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
        this.setData({
          players,
          matchId: match.id,
          matchTitle: `${dualDateStr} ${match.location} · 全场视角`,
          callerTeam: '',
          isCaptain: false,
          canEdit: false,
          dualView: true,
          state: 'ok',
        })
        return
      }

      const myTeam: 'A' | 'B' | '' = callerTeam ?? (isCaptainA ? 'A' : isCaptainB ? 'B' : '')
      if (!myTeam) {
        this.setData({
          state: 'no-team',
          lockMessage: '你未被分到任何队伍',
          matchId: match.id,
          matchTitle: `${new Date(match.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${match.location}`,
        })
        return
      }

      const myTeamPlayers = registrations.filter(r =>
        (r.status === 'confirmed' || r.status === 'promoted') && r.team === myTeam,
      )

      const { pitchWidth: pw, pitchHeight: ph, tokenPx } = this.data
      const half = Math.round(tokenPx / 2)
      const savedPositions = formation && !('A' in (formation.positions || {}))
        ? (formation.positions as Record<string, { x: number; y: number }>)
        : {}

      const players: PitchPlayer[] = myTeamPlayers.map((r, i) => {
        const saved = savedPositions[r.uid]
        const slot = SLOTS[i] ?? [0.5, 0.5]
        const x = saved ? Math.round(saved.x * pw) : Math.round(slot[0] * pw - half)
        const y = saved ? Math.round(saved.y * ph) : Math.round(slot[1] * ph - half)
        const name = (r.displayName ?? '?').trim()
        return {
          uid: r.uid,
          name,
          initial: name.charAt(0).toUpperCase() || '?',
          position: (r.preferredPositions ?? [])[0] ?? '',
          team: myTeam,
          x, y,
          isMe: r.uid === user._id,
        }
      })

      const dateStr = new Date(match.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
      this.setData({
        players,
        matchId: match.id,
        matchTitle: `${dateStr} ${match.location} · 队${myTeam}`,
        callerTeam: myTeam,
        isCaptain,
        canEdit: isCaptain,
        dualView: false,
        state: 'ok',
      })
    } catch (err) {
      console.error('tactics loadData failed', err)
      this.setData({ state: 'no-match' })
    }
  },

  onMove(e: WechatMiniprogram.BaseEvent & { detail: { x: number; y: number; source: string } }) {
    if (!this.data.canEdit) return
    if (e.detail.source !== 'touch') return
    const idx = (e.currentTarget.dataset as { idx: number }).idx
    const players = [...this.data.players]
    players[idx] = { ...players[idx], x: e.detail.x, y: e.detail.y }
    this.setData({ players })
  },

  async saveFormation() {
    if (!this.data.matchId || !this.data.canEdit) return
    const positions: Record<string, { x: number; y: number }> = {}
    const { pitchWidth: pw, pitchHeight: ph } = this.data
    this.data.players.forEach(p => {
      positions[p.uid] = { x: p.x / pw, y: p.y / ph }
    })
    try {
      await wx.cloud.callFunction({
        name: 'saveFormation',
        data: { matchId: this.data.matchId, positions },
      })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch {
      wx.showToast({ title: '保存失败', icon: 'error' })
    }
  },
})
