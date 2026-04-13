import type { User, CardTier, CardThresholds } from '../types'
import { TIER_BORDER, TIER_TEXT, TIER_RING, getNextTierProgress, DEFAULT_THRESHOLDS } from '../utils/cardTier'

// ─── Full card ─────────────────────────────────────────────────────────────

interface PlayerCardProps {
  user: User
  tier: CardTier
  thresholds?: CardThresholds
  onAvatarClick?: () => void
}

export function PlayerCard({ user, tier, thresholds = DEFAULT_THRESHOLDS, onAvatarClick }: PlayerCardProps) {
  const borderClass = TIER_BORDER[tier]
  const textClass   = TIER_TEXT[tier]
  const progress    = getNextTierProgress(user.attendanceCount, thresholds)

  return (
    <div className={`relative bg-gradient-to-b from-navy-light to-navy
                     border rounded-2xl shadow-lg p-5 w-full ${borderClass}`}>
      {/* Attendance count + next tier hint */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-baseline gap-1.5">
          <span className="text-white font-black text-sm tabular-nums">{user.attendanceCount}</span>
          <span className="text-slate text-[10px]">场</span>
        </div>
        {progress && (
          <span className={`text-[10px] font-bold ${progress.colorClass}`}>
            再 {progress.gamesLeft} 场 →
          </span>
        )}
      </div>

      {/* Avatar */}
      <div className="flex justify-center mb-4">
        <button
          onClick={onAvatarClick}
          className={`w-20 h-20 rounded-full overflow-hidden ${TIER_RING[tier]}
                      ${onAvatarClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'}`}
        >
          {user.avatar ? (
            <img src={user.avatar} alt={user.displayName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-teal to-teal-dark
                            flex items-center justify-center">
              <span className="text-pitch text-2xl font-black">
                {(user.displayName || user.phone).charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </button>
        {onAvatarClick && (
          <div className="absolute mt-[72px] ml-[72px]">
            <div className="w-6 h-6 rounded-full bg-teal flex items-center justify-center shadow-lg">
              <svg className="w-3 h-3 text-pitch" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Name */}
      <p className="text-white font-black text-center text-base tracking-tight truncate">
        {user.displayName || <span className="text-slate text-sm font-normal">未设置名字</span>}
      </p>

      {/* Positions — first one is most preferred */}
      {user.preferredPositions.length > 0 && (
        <div className="flex justify-center gap-1.5 mt-2 flex-wrap">
          {user.preferredPositions.map((pos, i) => (
            <span key={pos}
              className={`text-[10px] font-black px-2 py-0.5 rounded border
                         ${i === 0
                           ? tier !== 'none'
                             ? `${textClass} border-current bg-current/10`
                             : 'text-teal border-teal/40 bg-teal/10'
                           : 'text-slate border-surface'}`}>
              {pos}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Mini card (for tactical board) ────────────────────────────────────────

interface MiniCardProps {
  user: User
  tier: CardTier
  dragging?: boolean
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void
}

export function MiniCard({ user, tier, dragging, onPointerDown }: MiniCardProps) {
  const ringClass = TIER_RING[tier]
  const textClass = TIER_TEXT[tier]

  return (
    <div
      onPointerDown={onPointerDown}
      className={`flex flex-col items-center gap-1 select-none
                  ${onPointerDown ? 'cursor-grab active:cursor-grabbing' : ''}
                  ${dragging ? 'opacity-80 scale-110 z-50' : 'z-10'}`}
      style={{ touchAction: 'none' }}
    >
      <div className={`w-9 h-9 rounded-full overflow-hidden ${ringClass}`}>
        {user.avatar ? (
          <img src={user.avatar} alt={user.displayName} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-teal to-teal-dark
                          flex items-center justify-center">
            <span className="text-pitch text-sm font-black">
              {(user.displayName || user.phone).charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>
      <div className={`text-[9px] font-bold text-center leading-tight max-w-[52px] truncate
                       ${tier !== 'none' ? textClass : 'text-white/90'}`}>
        {user.displayName.split(' ')[0] || user.phone.slice(-4)}
      </div>
    </div>
  )
}
