import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, getDocs, doc, addDoc, updateDoc,
  serverTimestamp, query, orderBy, writeBatch,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuthStore } from '../../stores/authStore'
import type { PaymentEvent, Payment, PaymentEventType } from '../../types'

export default function AdminPayments() {
  const navigate = useNavigate()
  const { userProfile } = useAuthStore()

  const [events, setEvents] = useState<PaymentEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [eventPayments, setEventPayments] = useState<Payment[]>([])
  const [loadingPayments, setLoadingPayments] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Create form state
  const [title, setTitle] = useState('')
  const [type, setType] = useState<PaymentEventType>('member')
  const [annualAmount, setAnnualAmount] = useState('')
  const [perSessionAmount, setPerSessionAmount] = useState('')
  const [venmoHandle, setVenmoHandle] = useState('')
  const [creating, setCreating] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = async () => {
    const snap = await getDocs(query(collection(db, 'paymentEvents'), orderBy('createdAt', 'desc')))
    setEvents(snap.docs.map((d) => ({
      id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate(),
    })) as PaymentEvent[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const loadPayments = async (eventId: string) => {
    if (selectedId === eventId) { setSelectedId(null); return }
    setSelectedId(eventId)
    setLoadingPayments(true)
    const snap = await getDocs(collection(db, 'paymentEvents', eventId, 'payments'))
    setEventPayments(snap.docs.map((d) => ({
      id: d.id, ...d.data(), paidAt: d.data().paidAt?.toDate(),
    })) as Payment[])
    setLoadingPayments(false)
  }

  const handleCreate = async () => {
    if (!title.trim() || !venmoHandle.trim()) return
    const ann = parseFloat(annualAmount)
    const per = parseFloat(perSessionAmount)
    if (isNaN(ann) || isNaN(per)) return
    setCreating(true)
    try {
      const ref = await addDoc(collection(db, 'paymentEvents'), {
        title: title.trim(),
        type,
        annualAmount: ann,
        perSessionAmount: per,
        venmoHandle: venmoHandle.trim(),
        status: 'open',
        createdAt: serverTimestamp(),
      })
      // reset form
      setTitle(''); setType('member'); setAnnualAmount(''); setPerSessionAmount(''); setVenmoHandle('')
      setShowForm(false)
      await load()
      setSelectedId(ref.id)
      setEventPayments([])
    } finally { setCreating(false) }
  }

  const handleConfirm = async (payment: Payment, event: PaymentEvent) => {
    if (!userProfile) return
    setConfirming(payment.uid)
    try {
      const batch = writeBatch(db)
      // Confirm payment
      batch.update(doc(db, 'paymentEvents', event.id, 'payments', payment.uid), {
        status: 'confirmed',
        confirmedAt: serverTimestamp(),
        confirmedBy: userProfile.uid,
      })
      // Update user membership if member-type event
      if (event.type === 'member') {
        batch.update(doc(db, 'users', payment.uid), { membershipType: 'annual' })
      }
      await batch.commit()
      setEventPayments((prev) =>
        prev.map((p) => p.uid === payment.uid ? { ...p, status: 'confirmed' } : p)
      )
    } finally { setConfirming(null) }
  }

  const handleToggleStatus = async (event: PaymentEvent) => {
    const newStatus = event.status === 'open' ? 'closed' : 'open'
    await updateDoc(doc(db, 'paymentEvents', event.id), { status: newStatus })
    setEvents((prev) => prev.map((e) => e.id === event.id ? { ...e, status: newStatus } : e))
  }

  const pending = eventPayments.filter((p) => p.status === 'pending')
  const confirmed = eventPayments.filter((p) => p.status === 'confirmed')

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin')} className="text-slate hover:text-white transition-colors">
          ← 返回
        </button>
        <h1 className="text-white text-xl font-black">Payments</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto bg-teal hover:bg-teal-dark text-pitch font-black
                     text-xs px-4 py-2 rounded-xl transition-colors"
        >
          {showForm ? '取消' : '+ 新建'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-navy border border-surface rounded-2xl p-5 space-y-4">
          <p className="text-white font-black text-sm">新建支付活动</p>

          <div>
            <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">标题</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：2025赛季会费"
              className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                         px-4 py-3 text-white placeholder-muted text-sm focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">类型</label>
            <div className="flex gap-2">
              {(['member', 'event'] as PaymentEventType[]).map((t) => (
                <button key={t} onClick={() => setType(t)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all
                    ${type === t
                      ? 'bg-teal border-teal text-pitch'
                      : 'border-surface text-slate hover:text-white'}`}>
                  {t === 'member' ? '会费' : '活动费'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">年卡金额 ($)</label>
              <input type="number" value={annualAmount} onChange={(e) => setAnnualAmount(e.target.value)}
                placeholder="0"
                className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                           px-4 py-3 text-white placeholder-muted text-sm focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">次卡金额 ($)</label>
              <input type="number" value={perSessionAmount} onChange={(e) => setPerSessionAmount(e.target.value)}
                placeholder="0"
                className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                           px-4 py-3 text-white placeholder-muted text-sm focus:outline-none transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">Venmo 账号</label>
            <div className="flex rounded-xl overflow-hidden border border-surface focus-within:border-teal transition-colors">
              <span className="px-3 py-3 bg-surface text-slate text-sm select-none shrink-0">@</span>
              <input type="text" value={venmoHandle} onChange={(e) => setVenmoHandle(e.target.value)}
                placeholder="venmo-username"
                className="flex-1 px-4 py-3 bg-navy-light text-white placeholder-muted text-sm focus:outline-none"
              />
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={creating || !title.trim() || !venmoHandle.trim() || !annualAmount || !perSessionAmount}
            className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                       py-4 rounded-xl transition-all duration-150 disabled:opacity-40"
          >
            {creating ? '创建中...' : '发布支付活动'}
          </button>
        </div>
      )}

      {/* Events list */}
      {events.length === 0 ? (
        <p className="text-muted text-sm text-center py-8">暂无支付活动</p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="bg-navy border border-surface rounded-2xl overflow-hidden">
              {/* Event card header */}
              <button
                onClick={() => loadPayments(event.id)}
                className="w-full p-4 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-white font-bold text-sm truncate">{event.title}</p>
                      <span className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full border
                        ${event.type === 'member'
                          ? 'text-teal border-teal/30 bg-teal/10'
                          : 'text-gold border-gold/30 bg-gold/10'}`}>
                        {event.type === 'member' ? '会费' : '活动费'}
                      </span>
                    </div>
                    <p className="text-slate text-xs">
                      年卡 ${event.annualAmount} · 次卡 ${event.perSessionAmount} · @{event.venmoHandle}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border
                      ${event.status === 'open'
                        ? 'text-teal border-teal/30 bg-teal/10'
                        : 'text-slate border-surface bg-surface'}`}>
                      {event.status === 'open' ? '进行中' : '已关闭'}
                    </span>
                    <svg
                      className={`w-4 h-4 text-slate transition-transform ${selectedId === event.id ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </button>

              {/* Expanded payments */}
              {selectedId === event.id && (
                <div className="border-t border-surface px-4 pb-4 space-y-3 pt-3">
                  {/* Toggle open/close */}
                  <button
                    onClick={() => handleToggleStatus(event)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all
                      ${event.status === 'open'
                        ? 'border-red-hot/40 text-red-hot hover:bg-red-hot/10'
                        : 'border-teal/40 text-teal hover:bg-teal/10'}`}
                  >
                    {event.status === 'open' ? '关闭此活动' : '重新开放'}
                  </button>

                  {loadingPayments ? (
                    <div className="flex justify-center py-4">
                      <div className="w-5 h-5 border-2 border-teal border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : eventPayments.length === 0 ? (
                    <p className="text-muted text-sm text-center py-2">暂无支付记录</p>
                  ) : (
                    <>
                      {pending.length > 0 && (
                        <div>
                          <p className="text-[10px] font-black text-gold uppercase tracking-widest mb-2">
                            待确认 ({pending.length})
                          </p>
                          <div className="space-y-2">
                            {pending.map((p) => (
                              <div key={p.uid}
                                className="flex items-center justify-between gap-3 bg-gold/5 border border-gold/20 rounded-xl px-3 py-2.5">
                                <div className="min-w-0">
                                  <p className="text-white text-sm font-bold truncate">{p.displayName}</p>
                                  <p className="text-slate text-xs">
                                    {p.membershipType === 'annual' ? '年卡' : '次卡'} · ${p.amount}
                                  </p>
                                </div>
                                <button
                                  onClick={() => handleConfirm(p, event)}
                                  disabled={confirming === p.uid}
                                  className="shrink-0 bg-teal hover:bg-teal-dark text-pitch font-black
                                             text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                                >
                                  {confirming === p.uid ? '...' : '确认'}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {confirmed.length > 0 && (
                        <div>
                          <p className="text-[10px] font-black text-teal uppercase tracking-widest mb-2">
                            已确认 ({confirmed.length})
                          </p>
                          <div className="space-y-2">
                            {confirmed.map((p) => (
                              <div key={p.uid}
                                className="flex items-center justify-between gap-3 bg-teal/5 border border-teal/20 rounded-xl px-3 py-2.5">
                                <div className="min-w-0">
                                  <p className="text-white text-sm font-bold truncate">{p.displayName}</p>
                                  <p className="text-slate text-xs">
                                    {p.membershipType === 'annual' ? '年卡' : '次卡'} · ${p.amount}
                                  </p>
                                </div>
                                <svg className="w-5 h-5 text-teal shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
