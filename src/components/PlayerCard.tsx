import type { User, CardTier } from '../types'
import { TIER_LABEL, TIER_BORDER, TIER_TEXT, TIER_RING } from '../utils/cardTier'

// ─── Full card ─────────────────────────────────────────────────────────────

interface PlayerCardProps {
  user: User
  tier: CardTier
  onAvatarClick?: () => void
}

export function PlayerCard({ user, tier, onAvatarClick }: PlayerCardProps) {
  const borderClass = TIER_BORDER[tier]
  const textClass   = TIER_TEXT[tier]
  const label       = TIER_LABEL[tier]

  return (
    <div className={`relative bg-gradient-to-b from-navy-light to-navy
                     border rounded-2xl shadow-lg p-5 w-full ${borderClass}`}>
      {/* Tier badge + count */}
      <div className="flex items-center justify-between mb-4">
        {label
          ? <span className={`text-[10px] font-black uppercase tracking-widest ${textClass}`}>{label}</span>
          : <span />
        }
        <div className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5 text-slate" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
          </svg>
          <span className="text-slate text-xs font-bold tabular-nums">{user.attendanceCount}</span>
        </div>
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
              <svg className="w-3 h-3 text-pitch" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
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

      {/* Positions */}
      {user.preferredPositions.length > 0 && (
        <div className="flex justify-center gap-1.5 mt-2 flex-wrap">
          {user.preferredPositions.map((pos) => (
            <span key={pos}
              className={`text-[10px] font-black px-2 py-0.5 rounded border
                         ${tier !== 'none' ? `${textClass} border-current bg-current/10` : 'text-slate border-surface'}`}>
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
  const textClass  = TIER_TEXT[tier]

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
                       ${tier !== 'none' ? textClass : 'text-white'}`}>
        {user.displayName.split(' ')[0] || user.phone.slice(-4)}
      </div>
    </div>
  )
}
