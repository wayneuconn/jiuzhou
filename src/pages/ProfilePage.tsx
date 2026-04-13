import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { db, auth } from '../lib/firebase'
import { useAuthStore } from '../stores/authStore'

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']

const membershipColor: Record<string, string> = {
  active:   'text-teal border-teal/30 bg-teal/10',
  pending:  'text-gold border-gold/30 bg-gold/10',
  rejected: 'text-red-hot border-red-hot/30 bg-red-hot/10',
  expired:  'text-slate border-surface bg-surface',
}

const paymentColor: Record<string, string> = {
  paid:                 'text-teal border-teal/30 bg-teal/10',
  pending_confirmation: 'text-gold border-gold/30 bg-gold/10',
  unpaid:               'text-red-hot border-red-hot/30 bg-red-hot/10',
}

export default function ProfilePage() {
  const { userProfile } = useAuthStore()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [positions, setPositions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (userProfile) {
      setDisplayName(userProfile.displayName)
      setPositions(userProfile.preferredPositions)
    }
  }, [userProfile])

  const togglePosition = (pos: string) => {
    setPositions((prev) => {
      if (prev.includes(pos)) return prev.filter((p) => p !== pos)
      if (prev.length >= 3) return prev // max 3
      return [...prev, pos]
    })
  }

  const handleSave = async () => {
    if (!userProfile) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', userProfile.uid), {
        displayName,
        preferredPositions: positions,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const handleSignOut = async () => {
    await signOut(auth)
    navigate('/login')
  }

  if (!userProfile) return null

  const initial = (displayName || userProfile.phone).charAt(0).toUpperCase()

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
            {displayName || <span className="text-slate">未设置名字</span>}
          </h1>
          <p className="text-slate text-sm">{userProfile.phone}</p>
        </div>
      </div>

      {/* Status badges */}
      <div className="flex gap-2 flex-wrap">
        <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1
                          rounded-full border ${membershipColor[userProfile.membershipStatus]}`}>
          {userProfile.membershipStatus}
        </span>
        <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1
                          rounded-full border ${paymentColor[userProfile.paymentStatus]}`}>
          {userProfile.paymentStatus.replace('_', ' ')}
        </span>
        <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1
                         rounded-full border text-slate border-surface bg-surface">
          {userProfile.role}
        </span>
      </div>

      {/* Display name */}
      <div className="bg-navy border border-surface rounded-2xl p-4">
        <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">
          名字
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="输入你的名字"
          className="w-full bg-transparent text-white text-base font-semibold
                     placeholder-muted focus:outline-none"
        />
      </div>

      {/* Preferred positions (max 3) */}
      <div className="bg-navy border border-surface rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <label className="text-[10px] font-black text-slate uppercase tracking-widest">
            惯用位置
          </label>
          <span className={`text-xs font-black tabular-nums
            ${positions.length === 3 ? 'text-gold' : 'text-slate'}`}>
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
        <p className="text-muted text-xs mt-3">最多选3个位置</p>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving || !displayName.trim()}
        className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                   py-4 rounded-xl transition-all duration-150 disabled:opacity-40 text-base"
      >
        {saved ? '✓ 已保存' : saving ? '保存中...' : '保存'}
      </button>

      {/* Sign out */}
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
