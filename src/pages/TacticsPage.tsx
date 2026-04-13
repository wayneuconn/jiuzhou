import { useState, useEffect, useRef, useCallback } from 'react'
import { collection, getDocs, doc, setDoc, getDoc, serverTimestamp, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/authStore'
import { MiniCard } from '../components/PlayerCard'
import { getCardTier, DEFAULT_THRESHOLDS } from '../utils/cardTier'
import type { User, CardThresholds } from '../types'

function FootballPitch() {
  return (
    <svg
      viewBox="0 0 420 630"
      className="absolute inset-0 w-full h-full"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="pitch-stripes" x="0" y="0" width="420" height="84" patternUnits="userSpaceOnUse">
          <rect x="0" y="0"  width="420" height="42" fill="#265c26"/>
          <rect x="0" y="42" width="420" height="42" fill="#235523"/>
        </pattern>
      </defs>
      {/* Background */}
      <rect width="420" height="630" fill="url(#pitch-stripes)"/>
      {/* Outer boundary */}
      <rect x="15" y="15" width="390" height="600" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2.5"/>
      {/* Center line */}
      <line x1="15" y1="315" x2="405" y2="315" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      {/* Center circle */}
      <circle cx="210" cy="315" r="52" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <circle cx="210" cy="315" r="3.5" fill="rgba(255,255,255,0.75)"/>
      {/* Top penalty area */}
      <rect x="100" y="15" width="220" height="100" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      {/* Top goal area */}
      <rect x="157" y="15" width="106" height="32" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      {/* Top penalty spot */}
      <circle cx="210" cy="78" r="3" fill="rgba(255,255,255,0.75)"/>
      {/* Top penalty arc */}
      <path d="M 174 115 A 52 52 0 0 1 246 115" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      {/* Bottom penalty area */}
      <rect x="100" y="515" width="220" height="100" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      {/* Bottom goal area */}
      <rect x="157" y="583" width="106" height="32" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      {/* Bottom penalty spot */}
      <circle cx="210" cy="552" r="3" fill="rgba(255,255,255,0.75)"/>
      {/* Bottom penalty arc */}
      <path d="M 174 515 A 52 52 0 0 0 246 515" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      {/* Goals */}
      <rect x="168" y="2"   width="84" height="15" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <rect x="168" y="613" width="84" height="15" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      {/* Corner arcs */}
      <path d="M 15 55 A 40 40 0 0 1 55 15" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <path d="M 365 15 A 40 40 0 0 1 405 55" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <path d="M 15 575 A 40 40 0 0 0 55 615" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
      <path d="M 365 615 A 40 40 0 0 0 405 575" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2"/>
    </svg>
  )
}

function defaultPositions(users: User[]): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {}
  const cols = 4
  users.forEach((u, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const colsInRow = Math.min(cols, users.length - row * cols)
    pos[u.uid] = {
      x: ((col + 0.5) / colsInRow) * 82 + 9,
      y: row * 18 + 6,
    }
  })
  return pos
}

export default function TacticsPage() {
  const { userProfile } = useAuthStore()
  const isAdmin = userProfile?.role === 'admin'

  const [users, setUsers]             = useState<User[]>([])
  const [positions, setPositions]     = useState<Record<string, { x: number; y: number }>>({})
  const [thresholds, setThresholds]   = useState<CardThresholds>(DEFAULT_THRESHOLDS)
  const [dragging, setDragging]       = useState<string | null>(null)
  const [loading, setLoading]         = useState(true)
  const [saved, setSaved]             = useState(false)
  const [isCaptain, setIsCaptain]     = useState(false)

  const pitchRef      = useRef<HTMLDivElement>(null)
  const draggingRef   = useRef<string | null>(null)
  const positionsRef  = useRef(positions)
  useEffect(() => { positionsRef.current = positions }, [positions])

  useEffect(() => {
    const load = async () => {
      const [usersSnap, tacticSnap, configSnap, activeMatchesSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDoc(doc(db, 'tactics', 'default')),
        getDoc(doc(db, 'config', 'appConfig')),
        getDocs(query(
          collection(db, 'matches'),
          where('status', 'in', ['registration_r2', 'drafting', 'ready']),
        )),
      ])

      const loadedUsers = (usersSnap.docs
        .map((d) => ({
          uid: d.id,
          ...d.data(),
          attendanceCount: d.data().attendanceCount ?? 0,
          membershipType: d.data().membershipType ?? 'none',
        })) as User[])
        .filter((u) => u.displayName)
        .sort((a, b) => b.attendanceCount - a.attendanceCount)

      setUsers(loadedUsers)

      if (tacticSnap.exists() && tacticSnap.data().positions) {
        setPositions(tacticSnap.data().positions)
      } else {
        setPositions(defaultPositions(loadedUsers))
      }

      if (configSnap.exists() && configSnap.data().cardThresholds) {
        setThresholds(configSnap.data().cardThresholds)
      }

      if (userProfile) {
        const uid = userProfile.uid
        const captain = activeMatchesSnap.docs.some((d) => {
          const data = d.data()
          return data.captainA === uid || data.captainB === uid
        })
        setIsCaptain(captain)
      }

      setLoading(false)
    }
    load()
  }, [userProfile])

  // Stable pointer event handlers using refs
  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current || !pitchRef.current) return
    const rect = pitchRef.current.getBoundingClientRect()
    const x = Math.max(3, Math.min(91, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(2, Math.min(93, ((e.clientY - rect.top) / rect.height) * 100))
    setPositions((prev) => ({ ...prev, [draggingRef.current!]: { x, y } }))
  }, [])

  const handlePointerUp = useCallback(async () => {
    if (!draggingRef.current) return
    draggingRef.current = null
    setDragging(null)
    // Auto-save after drop
    try {
      await setDoc(doc(db, 'tactics', 'default'), {
        positions: positionsRef.current,
        updatedAt: serverTimestamp(),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch { /* ignore save errors silently */ }
  }, [])

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [handlePointerMove, handlePointerUp])

  const canEdit = isAdmin || isCaptain

  const startDrag = (uid: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canEdit) return
    e.preventDefault()
    draggingRef.current = uid
    setDragging(uid)
  }

  const handleReset = async () => {
    const newPos = defaultPositions(users)
    setPositions(newPos)
    await setDoc(doc(db, 'tactics', 'default'), { positions: newPos, updatedAt: serverTimestamp() })
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-black tracking-tight">战术板</h1>
          <p className="text-slate text-xs mt-0.5">
            {canEdit ? '拖动球员调整位置，自动保存' : '查看阵型'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-teal text-xs font-bold">✓ 已保存</span>}
          {canEdit && (
            <button
              onClick={handleReset}
              className="text-slate hover:text-white text-xs font-bold border border-surface
                         hover:border-slate/50 px-3 py-1.5 rounded-lg transition-all"
            >
              重置
            </button>
          )}
        </div>
      </div>

      {/* Pitch */}
      <div
        ref={pitchRef}
        className="relative w-full rounded-2xl overflow-hidden shadow-2xl shadow-black/60"
        style={{ aspectRatio: '2/3' }}
      >
        <FootballPitch />

        {/* Player cards */}
        {users.map((user) => {
          const pos = positions[user.uid] ?? { x: 50, y: 50 }
          const tier = getCardTier(user.attendanceCount, thresholds)
          const isDragging = dragging === user.uid

          return (
            <div
              key={user.uid}
              className={`absolute transition-transform ${isDragging ? 'duration-0 z-50' : 'duration-150 z-10'}`}
              style={{
                left: `${pos.x}%`,
                top:  `${pos.y}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <MiniCard
                user={user}
                tier={tier}
                dragging={isDragging}
                onPointerDown={canEdit ? startDrag(user.uid) : undefined}
              />
            </div>
          )
        })}

        {users.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-white/50 text-sm">暂无成员</p>
          </div>
        )}
      </div>

      {/* Color guide — no tier names, just ring colors */}
      <div className="flex items-center gap-3 justify-center">
        <span className="text-muted text-[10px]">出勤圈色：</span>
        {([
          ['ring-bronze shadow-[0_0_6px_1px_rgba(184,115,51,0.4)]',  ''],
          ['ring-silver shadow-[0_0_6px_1px_rgba(168,169,173,0.45)]', ''],
          ['ring-gold   shadow-[0_0_6px_1px_rgba(240,180,41,0.5)]',   ''],
          ['ring-royal  shadow-[0_0_6px_1px_rgba(79,144,225,0.55)]',  ''],
        ] as const).map(([cls], i) => (
          <div key={i}
            className={`w-4 h-4 rounded-full ring-[3px] bg-navy ${cls}`} />
        ))}
      </div>
    </div>
  )
}
