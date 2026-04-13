import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, updateDoc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { db, auth } from '../lib/firebase'
import { useAuthStore } from '../stores/authStore'
import type { PaymentEvent, Payment, MembershipType } from '../types'

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']

const membershipLabel: Record<MembershipType, string> = {
  annual:      '年卡',
  per_session: '次卡',
  none:        '未激活',
}
const membershipStyle: Record<MembershipType, string> = {
  annual:      'text-teal border-teal/30 bg-teal/10',
  per_session: 'text-gold border-gold/30 bg-gold/10',
  none:        'text-slate border-surface bg-surface',
}

export default function ProfilePage() {
  const { userProfile } = useAuthStore()
  const navigate = useNavigate()

  // Edit profile state
  const [displayName, setDisplayName] = useState('')
  const [positions, setPositions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Payment state
  const [payEvents, setPayEvents] = useState<PaymentEvent[]>([])
  const [myPayments, setMyPayments] = useState<Record<string, Payment | null>>({})
  const [paying, setPaying] = useState<string | null>(null)  // eventId being paid

  useEffect(() => {
    if (userProfile) {
      setDisplayName(userProfile.displayName)
      setPositions(userProfile.preferredPositions)
    }
  }, [userProfile])

  useEffect(() => {
    if (!userProfile) return
    const load = async () => {
      const snap = await getDocs(query(collection(db, 'paymentEvents'), where('status', '==', 'open')))
      const events = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate(),
      })) as PaymentEvent[]
      setPayEvents(events)

      const payments: Record<string, Payment | null> = {}
      await Promise.all(events.map(async (e) => {
        const pSnap = await getDoc(doc(db, 'paymentEvents', e.id, 'payments', userProfile.uid))
        payments[e.id] = pSnap.exists()
          ? { id: pSnap.id, ...pSnap.data(), paidAt: pSnap.data().paidAt?.toDate() } as Payment
          : null
      }))
      setMyPayments(payments)
    }
    load()
  }, [userProfile?.uid])

  const togglePosition = (pos: string) => {
    setPositions((prev) => {
      if (prev.includes(pos)) return prev.filter((p) => p !== pos)
      if (prev.length >= 3) return prev
      return [...prev, pos]
    })
  }

  const handleSave = async () => {
    if (!userProfile) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', userProfile.uid), { displayName, preferredPositions: positions })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  const handlePay = async (event: PaymentEvent) => {
    if (!userProfile) return
    const amount = userProfile.membershipType === 'annual' ? event.annualAmount : event.perSessionAmount
    const venmoUrl = `https://venmo.com/${event.venmoHandle}?txn=pay&amount=${amount}&note=${encodeURIComponent(event.title)}`

    setPaying(event.id)
    // Open Venmo
    window.open(venmoUrl, '_blank')
    // Record payment as pending
    await setDoc(doc(db, 'paymentEvents', event.id, 'payments', userProfile.uid), {
      uid: userProfile.uid,
      displayName: userProfile.displayName,
      membershipType: userProfile.membershipType,
      amount,
      status: 'pending',
      paidAt: serverTimestamp(),
    })
    setMyPayments((prev) => ({
      ...prev,
      [event.id]: {
        id: userProfile.uid,
        uid: userProfile.uid,
        displayName: userProfile.displayName,
        membershipType: userProfile.membershipType,
        amount,
        status: 'pending',
        paidAt: new Date(),
      },
    }))
    setPaying(null)
  }

  const handleSignOut = async () => {
    await signOut(auth)
    navigate('/login')
  }

  if (!userProfile) return null

  const initial = (userProfile.displayName || userProfile.phone).charAt(0).toUpperCase()
  const mt = userProfile.membershipType

  return (
    <div className="space-y-4">
      {/* Player header */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal to-teal-dark
                        flex items-center justify-center shadow-lg shadow-teal/25 shrink-0">
          <span className="text-pitch text-2xl font-black">{initial}</span>
        </div>
        <div>
          <h1 className="text-white text-xl font-black">
            {userProfile.displayName || <span className="text-slate">未设置名字</span>}
          </h1>
          <p className="text-slate text-sm">{userProfile.phone}</p>
          <span className={`inline-block mt-1 text-[10px] font-black uppercase tracking-widest
                            px-2.5 py-1 rounded-full border ${membershipStyle[mt]}`}>
            {membershipLabel[mt]}
          </span>
        </div>
      </div>

      {/* Open payment events */}
      {payEvents.length > 0 && (
        <section>
          <h2 className="text-[10px] font-black text-slate uppercase tracking-widest mb-2">待付款</h2>
          <div className="space-y-3">
            {payEvents.map((event) => {
              const payment = myPayments[event.id]
              const amount = mt === 'annual' ? event.annualAmount : event.perSessionAmount
              return (
                <div key={event.id} className="bg-navy border border-surface rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <p className="text-white font-bold text-sm">{event.title}</p>
                      <p className="text-teal font-black text-lg mt-0.5">${amount}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-black uppercase tracking-widest
                                     px-2.5 py-1 rounded-full border
                                     ${event.type === 'member'
                                       ? 'text-teal border-teal/30 bg-teal/10'
                                       : 'text-gold border-gold/30 bg-gold/10'}`}>
                      {event.type === 'member' ? '会费' : '活动费'}
                    </span>
                  </div>

                  {!payment ? (
                    <button
                      onClick={() => handlePay(event)}
                      disabled={paying === event.id}
                      className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                                 py-3 rounded-xl transition-all duration-150 disabled:opacity-40 text-sm"
                    >
                      {paying === event.id ? '跳转中...' : `去支付 $${amount} →`}
                    </button>
                  ) : payment.status === 'pending' ? (
                    <div className="flex items-center gap-2 bg-gold/10 border border-gold/30 rounded-xl px-4 py-3">
                      <div className="w-2 h-2 rounded-full bg-gold animate-pulse shrink-0" />
                      <span className="text-gold text-sm font-semibold">等待管理员确认</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-teal/10 border border-teal/30 rounded-xl px-4 py-3">
                      <svg className="w-4 h-4 text-teal shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-teal text-sm font-semibold">已缴费</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Edit profile */}
      <div className="bg-navy border border-surface rounded-2xl p-4">
        <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">名字</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="输入你的名字"
          className="w-full bg-transparent text-white text-base font-semibold placeholder-muted focus:outline-none"
        />
      </div>

      <div className="bg-navy border border-surface rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <label className="text-[10px] font-black text-slate uppercase tracking-widest">惯用位置</label>
          <span className={`text-xs font-black tabular-nums ${positions.length === 3 ? 'text-gold' : 'text-slate'}`}>
            {positions.length}/3
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {POSITIONS.map((pos) => {
            const selected = positions.includes(pos)
            const disabled = !selected && positions.length >= 3
            return (
              <button
                key={pos}
                onClick={() => togglePosition(pos)}
                disabled={disabled}
                className={`px-3.5 py-2 rounded-lg text-xs font-black border transition-all duration-150
                  ${selected
                    ? 'bg-teal border-teal text-pitch shadow-md shadow-teal/30'
                    : disabled
                    ? 'bg-transparent border-surface text-muted cursor-not-allowed opacity-40'
                    : 'bg-transparent border-surface text-slate hover:border-teal/50 hover:text-white'
                  }`}
              >
                {pos}
              </button>
            )
          })}
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving || !displayName.trim()}
        className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                   py-4 rounded-xl transition-all duration-150 disabled:opacity-40 text-base"
      >
        {saved ? '✓ 已保存' : saving ? '保存中...' : '保存'}
      </button>

      <button
        onClick={handleSignOut}
        className="w-full border border-surface hover:border-red-hot/30 text-slate hover:text-red-hot
                   font-bold py-3.5 rounded-xl transition-all duration-150"
      >
        退出登录
      </button>
    </div>
  )
}
