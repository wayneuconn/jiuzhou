import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuthStore } from '../../stores/authStore'

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']

const POSITION_LABELS: Record<string, string> = {
  GK: 'Goalkeeper', CB: 'Centre Back', LB: 'Left Back', RB: 'Right Back',
  CDM: 'Def. Mid', CM: 'Centre Mid', CAM: 'Att. Mid',
  LW: 'Left Wing', RW: 'Right Wing', ST: 'Striker',
}

export default function SetupProfilePage() {
  const navigate = useNavigate()
  const { firebaseUser } = useAuthStore()
  const [displayName, setDisplayName] = useState('')
  const [positions, setPositions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const togglePosition = (pos: string) => {
    setPositions((prev) => {
      if (prev.includes(pos)) return prev.filter((p) => p !== pos)
      if (prev.length >= 3) return prev
      return [...prev, pos]
    })
  }

  const handleComplete = async () => {
    if (!displayName.trim()) { setError('请输入你的名字'); return }
    if (!firebaseUser) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        displayName: displayName.trim(),
        preferredPositions: positions,
      })
      navigate('/', { replace: true })
    } catch {
      setError('保存失败，请重试')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-pitch flex flex-col items-center justify-center px-6 py-12">
      {/* Header */}
      <div className="flex flex-col items-center mb-10 text-center">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal to-teal-dark
                        flex items-center justify-center mb-4 shadow-2xl shadow-teal/30">
          <span className="text-pitch text-3xl font-black">九</span>
        </div>
        <h1 className="text-white text-2xl font-black tracking-tight">欢迎加入九州！</h1>
        <p className="text-slate text-sm mt-2 max-w-[240px] leading-relaxed">
          先告诉大家你是谁，让队友认识你
        </p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        {/* Display name */}
        <div className="bg-navy border border-surface rounded-2xl p-5">
          <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-3">
            你的名字 <span className="text-red-hot">*</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="输入你的名字或昵称"
            maxLength={20}
            className="w-full bg-transparent text-white text-xl font-bold
                       placeholder-muted focus:outline-none"
            autoFocus
          />
          {displayName && (
            <div className="mt-3 pt-3 border-t border-surface flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal to-teal-dark
                              flex items-center justify-center shrink-0">
                <span className="text-pitch text-base font-black">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="text-white font-bold text-sm">{displayName}</p>
                <p className="text-slate text-xs">这是你在队内的显示名字</p>
              </div>
            </div>
          )}
        </div>

        {/* Preferred positions */}
        <div className="bg-navy border border-surface rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <label className="text-[10px] font-black text-slate uppercase tracking-widest block">
                惯用位置
              </label>
              <p className="text-muted text-xs mt-0.5">可以之后再改（最多3个）</p>
            </div>
            <span className={`text-sm font-black tabular-nums transition-colors
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
                  className={`flex flex-col items-center px-3 py-2 rounded-xl border
                              transition-all duration-150 min-w-[56px]
                    ${selected
                      ? 'bg-teal border-teal text-pitch shadow-lg shadow-teal/30'
                      : disabled
                      ? 'bg-transparent border-surface text-muted cursor-not-allowed opacity-40'
                      : 'bg-transparent border-surface text-slate hover:border-teal/50 hover:text-white'
                    }`}
                >
                  <span className="text-xs font-black">{pos}</span>
                  <span className={`text-[9px] mt-0.5 leading-none
                    ${selected ? 'text-pitch/70' : 'text-muted'}`}>
                    {POSITION_LABELS[pos]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {error && (
          <p className="text-red-hot text-sm bg-red-hot/10 border border-red-hot/20 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <button
          onClick={handleComplete}
          disabled={saving || !displayName.trim()}
          className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                     py-4 rounded-xl transition-all duration-150 disabled:opacity-40 text-base"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-pitch border-t-transparent rounded-full animate-spin" />
              保存中...
            </span>
          ) : '完成，进入九州 →'}
        </button>

        <p className="text-center text-muted text-xs">
          名字可以在「我的」页面随时修改
        </p>
      </div>
    </div>
  )
}
