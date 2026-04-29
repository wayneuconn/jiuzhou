import type { PlayerPosition } from '../../types/index'

interface PitchPlayer {
  uid: string
  name: string
  x: number
  y: number
}

Page({
  data: {
    players: [] as PitchPlayer[],
    pitchWidth: 0,
    pitchHeight: 0,
    isAdminOrCaptain: false,
  },

  onLoad() {
    const sys = wx.getSystemInfoSync()
    const width = sys.windowWidth - 24
    const height = width * 1.5
    this.setData({ pitchWidth: width, pitchHeight: height })
  },

  onMove(e: WechatMiniprogram.BaseEvent & { detail: { x: number; y: number; source: string } }) {
    if (!this.data.isAdminOrCaptain) return
    if (e.detail.source !== 'touch') return
    const idx = (e.currentTarget.dataset as { idx: number }).idx
    const players = [...this.data.players]
    players[idx] = { ...players[idx], x: e.detail.x, y: e.detail.y }
    this.setData({ players })
  },

  async saveFormation() {
    const positions: Record<string, PlayerPosition> = {}
    this.data.players.forEach((p) => {
      positions[p.uid] = { x: p.x / this.data.pitchWidth, y: p.y / this.data.pitchHeight }
    })
    try {
      await wx.cloud.callFunction({
        name: 'saveFormation',
        data: { positions },
      })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '保存失败', icon: 'error' })
    }
  },
})
