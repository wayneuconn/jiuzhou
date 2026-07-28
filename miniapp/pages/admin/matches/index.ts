import type { Match } from '../../../types/index'
import { formatDate, STATUS_LABEL, STATUS_BADGE } from '../../../utils/format'
import { bankAdminSubscribe } from '../../../utils/subscribe'

const STATUS_NEXT: Record<string, string> = {
  draft: 'registration_r1',
  registration_r1: 'registration_r2',
  registration_r2: 'drafting',
  drafting: 'ready',
  ready: 'completed',
}

// Advance-button copy: action verbs, not the target state's name —
// "选人中" on a button reads like the CURRENT phase.
const ACTION_LABEL: Record<string, string> = {
  registration_r1: '开放 R1 报名',
  registration_r2: '开放 R2 报名',
  drafting: '开始选人',
  ready: '完成选人',
  completed: '标记已结束',
}

interface MatchVM extends Match {
  dateStr: string
  statusLabel: string
  statusBadge: string
  nextStatus: string
  nextStatusLabel: string
  canAdvance: boolean
  canForceReady: boolean
  canBackToR2: boolean
  canEdit: boolean
}

const todayDateStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function showError(err: unknown, fallback: string) {
  const msg = (err as { errMsg?: string; message?: string })?.errMsg
    || (err as Error)?.message || fallback
  wx.showModal({ title: fallback, content: msg, showCancel: false })
}

Page({
  data: {
    matches: [] as MatchVM[],
    filteredMatches: [] as MatchVM[],
    showAll: false,
    loading: true,
    showCreateModal: false,
    creating: false,
    editingId: '',
    form: { location: '', maxPlayers: 22, date: todayDateStr(), time: '20:00' },
  },

  onShow() { this.loadMatches() },

  async loadMatches() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getMatches' }) as unknown as { result: { matches: Match[] } }
      const matches: MatchVM[] = res.result.matches.map(m => ({
        ...m,
        dateStr: formatDate(m.date),
        statusLabel: STATUS_LABEL[m.status] ?? m.status,
        statusBadge: STATUS_BADGE[m.status] ?? 'badge-grey',
        nextStatus: STATUS_NEXT[m.status] ?? '',
        nextStatusLabel: ACTION_LABEL[STATUS_NEXT[m.status]] ?? '',
        canAdvance: !!STATUS_NEXT[m.status] && m.status !== 'completed' && m.status !== 'cancelled',
        canForceReady: m.status === 'registration_r1' || m.status === 'registration_r2',
        canBackToR2: m.status === 'ready',
        canEdit: m.status !== 'completed' && m.status !== 'cancelled',
      }))
      this.setData({ matches }, () => this.applyFilter())
    } catch (err) { console.error(err) }
    finally { this.setData({ loading: false }) }
  },

  applyFilter() {
    const { matches, showAll } = this.data
    const filteredMatches = showAll
      ? matches
      : matches.filter(m => m.status !== 'completed' && m.status !== 'cancelled')
    this.setData({ filteredMatches })
  },

  toggleShowAll() {
    this.setData({ showAll: !this.data.showAll }, () => this.applyFilter())
  },

  openCreateModal() {
    this.setData({
      showCreateModal: true,
      editingId: '',
      form: { location: '', maxPlayers: 22, date: todayDateStr(), time: '20:00' },
    })
  },

  openEditModal(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const match = this.data.matches.find(m => m.id === id)
    if (!match) return
    const d = new Date(match.date)
    this.setData({
      showCreateModal: true,
      editingId: id,
      form: {
        location: match.location,
        maxPlayers: match.maxPlayers,
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      },
    })
  },

  closeCreateModal() { this.setData({ showCreateModal: false }) },

  onFormLocation(e: WechatMiniprogram.Input) { this.setData({ 'form.location': e.detail.value }) },
  onFormPlayers(e: WechatMiniprogram.Input) { this.setData({ 'form.maxPlayers': Number(e.detail.value) || 22 }) },
  onFormDate(e: WechatMiniprogram.BaseEvent & { detail: { value: string } }) { this.setData({ 'form.date': e.detail.value }) },
  onFormTime(e: WechatMiniprogram.BaseEvent & { detail: { value: string } }) { this.setData({ 'form.time': e.detail.value }) },

  async submitMatch() {
    const { location, maxPlayers, date, time } = this.data.form
    const { editingId } = this.data
    if (!location.trim()) { wx.showToast({ title: '请填写地点', icon: 'none' }); return }
    this.setData({ creating: true })
    try {
      // Send the raw date/time strings — the server interprets them in ET, so
      // an admin whose phone is on another timezone doesn't shift the kickoff.
      if (editingId) {
        await wx.cloud.callFunction({
          name: 'updateMatchStatus',
          data: { action: 'editMatch', matchId: editingId, location: location.trim(), maxPlayers, dateStr: date, timeStr: time },
        })
        wx.showToast({ title: '比赛已更新', icon: 'success' })
      } else {
        await wx.cloud.callFunction({
          name: 'createMatch',
          data: { location: location.trim(), maxPlayers, dateStr: date, timeStr: time },
        })
        wx.showToast({ title: '比赛已创建', icon: 'success' })
      }
      this.setData({ showCreateModal: false, editingId: '' })
      this.loadMatches()
    } catch (err: unknown) {
      showError(err, editingId ? '更新失败' : '创建失败')
    } finally { this.setData({ creating: false }) }
  },

  async advanceStatus(e: WechatMiniprogram.BaseEvent) {
    bankAdminSubscribe()
    const { id, next } = e.currentTarget.dataset as { id: string; next: string }
    const label = ACTION_LABEL[next] ?? STATUS_LABEL[next] ?? next
    const res = await wx.showModal({ title: `确认「${label}」？`, content: '', confirmColor: '#00C9A7' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: next } })
      this.loadMatches()
    } catch (err: unknown) { showError(err, '操作失败') }
  },

  async forceReady(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const res = await wx.showModal({ title: '强制设为已就绪？', content: '即使人数不足也将锁定名单', confirmColor: '#00C9A7' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: 'ready' } })
      this.loadMatches()
    } catch (err: unknown) { showError(err, '操作失败') }
  },

  async backToR2(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const res = await wx.showModal({ title: '回到 R2 报名？', content: '重新开放报名', confirmColor: '#F0B429' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: 'registration_r2' } })
      this.loadMatches()
    } catch (err: unknown) { showError(err, '操作失败') }
  },

  async cancelMatch(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const res = await wx.showModal({
      title: '确认取消比赛？',
      content: '此操作不可撤销，已报名球员将收到通知',
      editable: true,
      placeholderText: '取消原因（如：下雨、场地问题）',
      confirmColor: '#E53E3E',
    })
    if (!res.confirm) return
    const reason = (res.content || '').trim() || '因故取消'
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: 'cancelled', reason } })
      this.loadMatches()
    } catch (err: unknown) { showError(err, '操作失败') }
  },

  goDetail(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/match-detail/index?id=${id}` })
  },

  noop() {},
})
