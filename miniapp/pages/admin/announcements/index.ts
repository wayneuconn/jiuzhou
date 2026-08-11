import type { Announcement } from '../../../types/index'

type AnnVM = Announcement & { id: string }

Page({
  data: {
    announcements: [] as AnnVM[],
    loading: true,
    showModal: false,
    saving: false,
    form: { id: '', title: '', content: '', pinned: false, popup: false, popupUntil: '' },
  },

  onShow() { this.load() },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'adminGetAnnouncements' }) as unknown as {
        result: { announcements: (Announcement & { id: string })[] }
      }
      const announcements: AnnVM[] = res.result.announcements.map(a => ({ ...a }))
      this.setData({ announcements })
    } catch (err) { console.error(err) }
    finally { this.setData({ loading: false }) }
  },

  openNew() {
    this.setData({ showModal: true, form: { id: '', title: '', content: '', pinned: false, popup: false, popupUntil: '' } })
  },

  openEdit(e: WechatMiniprogram.BaseEvent) {
    const { id } = e.currentTarget.dataset as { id: string }
    const ann = this.data.announcements.find(a => a.id === id)
    if (!ann) return
    const until = ann.popupUntil ? new Date(ann.popupUntil) : null
    this.setData({
      showModal: true,
      form: {
        id: ann.id, title: ann.title, content: ann.content, pinned: ann.pinned,
        popup: !!ann.popup,
        popupUntil: until
          ? `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, '0')}-${String(until.getDate()).padStart(2, '0')}`
          : '',
      },
    })
  },

  closeModal() { this.setData({ showModal: false }) },
  noop() {},

  onTitle(e: WechatMiniprogram.Input) { this.setData({ 'form.title': e.detail.value }) },
  onContent(e: WechatMiniprogram.Input) { this.setData({ 'form.content': e.detail.value }) },
  onPinned(e: WechatMiniprogram.SwitchChange) { this.setData({ 'form.pinned': e.detail.value }) },
  onPopup(e: WechatMiniprogram.SwitchChange) { this.setData({ 'form.popup': e.detail.value }) },
  onPopupUntil(e: WechatMiniprogram.PickerChange) { this.setData({ 'form.popupUntil': e.detail.value as unknown as string }) },
  clearPopupUntil() { this.setData({ 'form.popupUntil': '' }) },

  async save() {
    const { id, title, content, pinned, popup, popupUntil } = this.data.form
    if (!title.trim() || !content.trim()) { wx.showToast({ title: '请填写标题和内容', icon: 'none' }); return }
    this.setData({ saving: true })
    try {
      await wx.cloud.callFunction({
        name: 'adminSaveAnnouncement',
        data: {
          id: id || undefined,
          title: title.trim(),
          content: content.trim(),
          pinned,
          popup,
          // end of the chosen day, so it stays visible all of that date
          popupUntil: popup && popupUntil ? new Date(`${popupUntil}T23:59:59`).getTime() : null,
        },
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ showModal: false })
      this.load()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg || (err as Error)?.message || '保存失败'
      wx.showModal({ title: '保存失败', content: msg, showCancel: false })
    }
    finally { this.setData({ saving: false }) }
  },

  async deleteAnn(e: WechatMiniprogram.BaseEvent) {
    const { id } = e.currentTarget.dataset as { id: string }
    const res = await wx.showModal({ title: '确认删除？', content: '此操作不可撤销', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'adminDeleteAnnouncement', data: { id } })
      wx.showToast({ title: '已删除', icon: 'success' })
      this.load()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg || (err as Error)?.message || '删除失败'
      wx.showModal({ title: '删除失败', content: msg, showCancel: false })
    }
  },
})
