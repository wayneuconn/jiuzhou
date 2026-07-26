import type { MembershipApplication } from '../../../types/index'
import { formatDateShort } from '../../../utils/format'

const TYPE_LABEL: Record<string, string> = { annual: '年卡', per_session: '次卡', none: '未激活' }
const STATUS_LABEL: Record<string, string> = { approved: '已批准', rejected: '已拒绝', cancelled: '已撤回' }

type AppVM = MembershipApplication & {
  requestedLabel: string
  currentLabel: string
  dateStr: string
  statusLabel: string
}

function toVM(a: MembershipApplication): AppVM {
  return {
    ...a,
    requestedLabel: TYPE_LABEL[a.requestedType] ?? a.requestedType,
    currentLabel: TYPE_LABEL[a.currentType] ?? a.currentType,
    dateStr: formatDateShort(a.createdAt),
    statusLabel: STATUS_LABEL[a.status] ?? a.status,
  }
}

Page({
  data: {
    pending: [] as AppVM[],
    decided: [] as AppVM[],
    loading: true,
    busy: false,
  },

  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getMembershipApplications' }) as unknown as {
        result: { pending: MembershipApplication[]; decided: MembershipApplication[] }
      }
      this.setData({
        pending: res.result.pending.map(toVM),
        decided: res.result.decided.map(toVM),
      })
    } catch (err) { console.error(err) }
    finally { this.setData({ loading: false }) }
  },

  async approve(e: WechatMiniprogram.BaseEvent) {
    const { id, name, type } = e.currentTarget.dataset as { id: string; name: string; type: string }
    const res = await wx.showModal({
      title: `批准 ${name} 的${type}申请？`,
      content: '批准后立即生效',
      confirmColor: '#00C9A7',
    })
    if (!res.confirm) return
    await this._decide(id, 'approved')
  },

  async reject(e: WechatMiniprogram.BaseEvent) {
    const { id, name } = e.currentTarget.dataset as { id: string; name: string }
    const res = await wx.showModal({
      title: `拒绝 ${name} 的申请？`,
      editable: true,
      placeholderText: '拒绝原因（可选，球员可见）',
      confirmColor: '#E53E3E',
    })
    if (!res.confirm) return
    await this._decide(id, 'rejected', (res.content || '').trim())
  },

  async _decide(appId: string, decision: 'approved' | 'rejected', reason?: string) {
    this.setData({ busy: true })
    try {
      await wx.cloud.callFunction({
        name: 'decideMembershipApplication',
        data: { appId, decision, reason },
      })
      wx.showToast({ title: decision === 'approved' ? '已批准' : '已拒绝', icon: 'success' })
      this.load()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg
        || (err as Error)?.message || '操作失败'
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },
})
