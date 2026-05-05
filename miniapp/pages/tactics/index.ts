import type { Match, Registration } from '../../types/index'

interface PitchPlayer {
  uid: string
  name: string
  x: number
  y: number
  team: 'A' | 'B' | null
}

// Default slot positions [xFrac, yFrac] — team A at top, B at bottom
const SLOTS_A: [number, number][] = [
  [0.5, 0.04],
  [0.15, 0.17], [0.38, 0.17], [0.62, 0.17], [0.85, 0.17],
  [0.2, 0.29], [0.5, 0.27], [0.8, 0.29],
  [0.2, 0.41], [0.5, 0.39], [0.8, 0.41],
]
const SLOTS_B: [number, number][] = [
  [0.5, 0.96],
  [0.15, 0.83], [0.38, 0.83], [0.62, 0.83], [0.85, 0.83],
  [0.2, 0.71], [0.5, 0.73], [0.8, 0.71],
  [0.2, 0.59], [0.5, 0.61], [0.8, 0.59],
]
const SLOTS_NONE: [number, number][] = [
  [0.04, 0.15], [0.04, 0.30], [0.04, 0.45], [0.04, 0.60], [0.04, 0.75],
  [0.96, 0.15], [0.96, 0.30], [0.96, 0.45], [0.96, 0.60], [0.96, 0.75],
]

Page({
  data: {
    players: [] as PitchPlayer[],
    pitchWidth: 0,
    pitchHeight: 0,
    tokenPx: 40,
    // pitch marking positions (px)
    halfwayY: 0,
    circleX: 0, circleY: 0, circleDiam: 0,
    penH: 0, penW: 0, penX: 0,
    goalW: 0, goalX: 0, goalH: 0,
    dotX: 0, dotTopY: 0, dotBotY: 0,
    // state
    matchId: '',
    matchTitle: '',
    isCaptain: false,
    loading: true,
    empty: false,
  },

  onLoad() {
    const sys = wx.getSystemInfoSync()
    const pw = sys.windowWidth - 32
    const ph = Math.round(pw * 1.6)
    const tokenPx = Math.round(pw * 0.107)

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
    this.loadData()
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const app = getApp<{ globalData: { userProfile: { _id: string; role: string } | null } }>()
      const user = app.globalData.userProfile

      const annRes = await wx.cloud.callFunction({ name: 'getAnnouncements' }) as unknown as {
        result: { nextMatch: (Match & { id: string }) | null }
      }
      const nextMatch = annRes.result.nextMatch
      if (!nextMatch) {
        this.setData({ empty: true, loading: false })
        return
      }

      const detailRes = await wx.cloud.callFunction({
        name: 'getMatchDetail',
        data: { matchId: nextMatch.id },
      }) as unknown as { result: { match: Match & { id: string }; registrations: (Registration & { uid: string })[] } }

      const { match, registrations } = detailRes.result
      const isCaptainA = !!match.captainA && user?._id === match.captainA
      const isCaptainB = !!match.captainB && user?._id === match.captainB

      const confirmed = registrations.filter(r => r.status === 'confirmed' || r.status === 'promoted')
      const teamA = confirmed.filter(r => r.team === 'A')
      const teamB = confirmed.filter(r => r.team === 'B')
      const unassigned = confirmed.filter(r => !r.team)

      const { pitchWidth: pw, pitchHeight: ph, tokenPx } = this.data
      const half = Math.round(tokenPx / 2)

      const place = (reg: Registration & { uid: string }, slot: [number, number], team: 'A' | 'B' | null): PitchPlayer => ({
        uid: reg.uid,
        name: (reg.displayName ?? '?').slice(0, 3),
        team,
        x: Math.round(slot[0] * pw - half),
        y: Math.round(slot[1] * ph - half),
      })

      const players: PitchPlayer[] = [
        ...teamA.map((r, i) => place(r, SLOTS_A[i] ?? [0.5, 0.5], 'A')),
        ...teamB.map((r, i) => place(r, SLOTS_B[i] ?? [0.5, 0.5], 'B')),
        ...unassigned.map((r, i) => place(r, SLOTS_NONE[i] ?? [0.1, 0.5], null)),
      ]

      const dateStr = new Date(match.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
      this.setData({
        players,
        matchId: match.id,
        matchTitle: `${dateStr} ${match.location}`,
        isCaptain: isCaptainA || isCaptainB,
        empty: false,
      })
    } catch (err) {
      console.error('tactics loadData failed', err)
      this.setData({ empty: true })
    } finally {
      this.setData({ loading: false })
    }
  },

  onMove(e: WechatMiniprogram.BaseEvent & { detail: { x: number; y: number; source: string } }) {
    if (!this.data.isCaptain) return
    if (e.detail.source !== 'touch') return
    const idx = (e.currentTarget.dataset as { idx: number }).idx
    const players = [...this.data.players]
    players[idx] = { ...players[idx], x: e.detail.x, y: e.detail.y }
    this.setData({ players })
  },

  async saveFormation() {
    if (!this.data.matchId) return
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
