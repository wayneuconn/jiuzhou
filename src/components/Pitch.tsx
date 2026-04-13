import { useState, useEffect, useRef, useCallback } from 'react'
import type { DocumentReference } from 'firebase/firestore'
import { onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { TIER_RING } from '../utils/cardTier'
import type { CardTier } from '../types'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PitchPlayer {
  uid: string
  displayName: string
  preferredPositions?: string[]
  avatar?: string
  tier?: CardTier          // optional — shows tier-coloured ring if provided
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function defaultPositions(
  players: PitchPlayer[],
): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {}
  const cols = Math.min(4, Math.max(1, players.length))
  players.forEach((p, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const colsInRow = Math.min(cols, players.length - row * cols)
    pos[p.uid] = {
      x: ((col + 0.5) / colsInRow) * 82 + 9,
      y: row * 18 + 6,
    }
  })
  return pos
}

// ─── SVG pitch ──────────────────────────────────────────────────────────────

function FootballPitch() {
  return (
    <svg
      viewBox="0 0 420 630"
      className="absolute inset-0 w-full h-full"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="ps" x="0" y="0" width="420" height="84" patternUnits="userSpaceOnUse">
          <rect x="0" y="0"  width="420" height="42" fill="#265c26"/>
          <rect x="0" y="42" width="420" height="42" fill="#235523"/>
        </pattern>
      </defs>
      <rect width="420" height="630" fill="url(#ps)"/>
      <rect x="15" y="15" width="390" height="600" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2.5"/>
      <line x1="15" y1="315" x2="405" y2="315" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <circle cx="210" cy="315" r="52" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <circle cx="210" cy="315" r="3.5" fill="rgba(255,255,255,0.75)"/>
      <rect x="100" y="15"  width="220" height="100" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <rect x="157" y="15"  width="106" height="32"  fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <circle cx="210" cy="78" r="3" fill="rgba(255,255,255,0.75)"/>
      <path d="M 174 115 A 52 52 0 0 1 246 115" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <rect x="100" y="515" width="220" height="100" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <rect x="157" y="583" width="106" height="32"  fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <circle cx="210" cy="552" r="3" fill="rgba(255,255,255,0.75)"/>
      <path d="M 174 515 A 52 52 0 0 0 246 515" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <rect x="168" y="2"   width="84" height="15" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <rect x="168" y="613" width="84" height="15" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <path d="M 15 55 A 40 40 0 0 1 55 15"    fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <path d="M 365 15 A 40 40 0 0 1 405 55"  fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <path d="M 15 575 A 40 40 0 0 0 55 615"  fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <path d="M 365 615 A 40 40 0 0 0 405 575" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
    </svg>
  )
}

// ─── Pitch component ─────────────────────────────────────────────────────────

interface PitchProps {
  players: PitchPlayer[]
  saveRef: DocumentReference     // Firestore doc where positions are persisted
  canEdit: boolean
}

export function Pitch({ players, saveRef, canEdit }: PitchProps) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [dragging, setDragging]   = useState<string | null>(null)
  const [saved, setSaved]         = useState(false)

  const pitchRef     = useRef<HTMLDivElement>(null)
  const draggingRef  = useRef<string | null>(null)
  const positionsRef = useRef(positions)
  useEffect(() => { positionsRef.current = positions }, [positions])

  // Subscribe to Firestore positions — re-subscribe when the path changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true
    const unsub = onSnapshot(
      saveRef,
      (snap) => {
        if (!alive) return
        if (snap.exists() && snap.data().positions) {
          setPositions(snap.data().positions)
        } else {
          setPositions(defaultPositions(players))
        }
      },
      () => { if (alive) setPositions(defaultPositions(players)) },
    )
    return () => { alive = false; unsub() }
  }, [saveRef.path]) // eslint-disable-line

  // Ensure any newly added player has a default position
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const missing = players.filter((p) => !positions[p.uid])
    if (!missing.length) return
    const defs = defaultPositions(players)
    setPositions((prev) => {
      const next = { ...prev }
      missing.forEach((p) => { if (!next[p.uid]) next[p.uid] = defs[p.uid] })
      return next
    })
  }, [players.map((p) => p.uid).join(',')])  // eslint-disable-line

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current || !pitchRef.current) return
    const rect = pitchRef.current.getBoundingClientRect()
    const x = Math.max(3, Math.min(91, ((e.clientX - rect.left)  / rect.width)  * 100))
    const y = Math.max(2, Math.min(93, ((e.clientY - rect.top) / rect.height) * 100))
    setPositions((prev) => ({ ...prev, [draggingRef.current!]: { x, y } }))
  }, [])

  const handlePointerUp = useCallback(async () => {
    if (!draggingRef.current) return
    draggingRef.current = null
    setDragging(null)
    try {
      await setDoc(saveRef, { positions: positionsRef.current, updatedAt: serverTimestamp() }, { merge: true })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch { /* permission denied — ignore */ }
  }, [saveRef])

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup',   handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup',   handlePointerUp)
    }
  }, [handlePointerMove, handlePointerUp])

  const startDrag = (uid: string) => (e: React.PointerEvent) => {
    if (!canEdit) return
    e.preventDefault()
    draggingRef.current = uid
    setDragging(uid)
  }

  return (
    <div className="space-y-1.5">
      {canEdit && saved && (
        <p className="text-teal text-[10px] font-bold text-right">✓ 已保存</p>
      )}
      <div
        ref={pitchRef}
        className="relative w-full rounded-2xl overflow-hidden shadow-xl shadow-black/50"
        style={{ aspectRatio: '2/3' }}
      >
        <FootballPitch />

        {players.map((player) => {
          const pos        = positions[player.uid] ?? { x: 50, y: 50 }
          const isDragging = dragging === player.uid
          const topPos     = player.preferredPositions?.[0]
          const ringCls    = player.tier ? TIER_RING[player.tier] : 'ring-2 ring-white/20'

          return (
            <div
              key={player.uid}
              className={`absolute transition-transform ${isDragging ? 'duration-0 z-50' : 'duration-150 z-10'}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              <div
                onPointerDown={canEdit ? startDrag(player.uid) : undefined}
                className={`flex flex-col items-center gap-1 select-none
                  ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''}
                  ${isDragging ? 'opacity-80 scale-110' : ''}`}
                style={{ touchAction: 'none' }}
              >
                <div className="relative">
                  <div className={`w-9 h-9 rounded-full overflow-hidden ${ringCls}`}>
                    {player.avatar ? (
                      <img src={player.avatar} alt={player.displayName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-teal to-teal-dark flex items-center justify-center">
                        <span className="text-pitch text-sm font-black">
                          {(player.displayName || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                  {topPos && (
                    <span className="absolute -right-[22px] top-1/2 -translate-y-1/2
                                     text-[8px] font-black px-1 py-0.5 rounded
                                     bg-pitch/80 text-white/90 border border-white/20 leading-none whitespace-nowrap">
                      {topPos}
                    </span>
                  )}
                </div>
                <span className="text-[9px] font-bold text-white/90 leading-tight max-w-[52px] truncate text-center">
                  {player.displayName.split(' ')[0] || '?'}
                </span>
              </div>
            </div>
          )
        })}

        {players.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-white/50 text-sm">暂无球员</p>
          </div>
        )}
      </div>
    </div>
  )
}
