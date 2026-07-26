interface BoardRow {
  uid: string
  displayName: string
  goals: number
  assists: number
}

Page({
  data: {
    tab: 'goals' as 'goals' | 'assists',
    scorers: [] as BoardRow[],
    assisters: [] as BoardRow[],
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
      const res = await wx.cloud.callFunction({ name: 'getLeaderboard' }) as unknown as {
        result: { scorers: BoardRow[]; assisters: BoardRow[] }
      }
      this.setData({
        scorers: res.result.scorers ?? [],
        assisters: res.result.assisters ?? [],
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
    const tab = (e.currentTarget.dataset as { tab: 'goals' | 'assists' }).tab
    this.setData({ tab })
  },

  onShareAppMessage() {
    return { title: '九州射手榜 · 助攻榜', path: '/pages/leaderboard/index' }
  },
})
