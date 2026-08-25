interface BoardRow {
  uid: string
  displayName: string
  goals: number
  assists: number
  isGuest?: boolean
}

interface CaptainRow {
  uid: string
  displayName: string
  games: number
  wins: number
  draws: number
  losses: number
  points: number
  avgPoints: number
  avgNet: number
  winRate: number
}

type Period = 'month' | 'year' | 'all'

Page({
  data: {
    tab: 'goals' as 'goals' | 'assists' | 'captains',
    period: 'month' as Period,
    periods: [
      { key: 'month', label: '月榜' },
      { key: 'year', label: '年榜' },
      { key: 'all', label: '总榜' },
    ],
    scorers: [] as BoardRow[],
    assisters: [] as BoardRow[],
    captains: [] as CaptainRow[],
    loading: true,
    loadError: false,
  },

  onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    this.loadBoard()
  },
  onPullDownRefresh() { this.loadBoard().finally(() => wx.stopPullDownRefresh()) },

  async loadBoard() {
    this.setData({ loading: true, loadError: false })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getLeaderboard',
        data: { period: this.data.period },
      }) as unknown as {
        result: { scorers: BoardRow[]; assisters: BoardRow[]; captains: CaptainRow[] }
      }
      this.setData({
        scorers: res.result.scorers ?? [],
        assisters: res.result.assisters ?? [],
        captains: res.result.captains ?? [],
      })
    } catch (err) {
      console.error('loadBoard failed', err)
      this.setData({ loadError: true })
    } finally {
      this.setData({ loading: false })
    }
  },

  retryLoad() { this.loadBoard() },

  setTab(e: WechatMiniprogram.BaseEvent) {
    const tab = (e.currentTarget.dataset as { tab: 'goals' | 'assists' | 'captains' }).tab
    this.setData({ tab })
  },

  setPeriod(e: WechatMiniprogram.BaseEvent) {
    const period = (e.currentTarget.dataset as { period: Period }).period
    if (period === this.data.period) return
    this.setData({ period }, () => this.loadBoard())
  },

  onShareAppMessage() {
    return { title: '九州射手榜 · 助攻榜', path: '/pages/leaderboard/index' }
  },
})
