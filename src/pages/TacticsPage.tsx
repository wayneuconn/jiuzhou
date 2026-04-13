import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, doc, getDoc, query, where, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/authStore'
import { Pitch, defaultPositions } from '../components/Pitch'
import type { PitchPlayer } from '../components/Pitch'
import { getCardTier, DEFAULT_THRESHOLDS } from '../utils/cardTier'
import type { User, CardThresholds } from '../types'

export default function TacticsPage() {
  const { userProfile } = useAuthStore()
  const isAdmin = userProfile?.role === 'admin'

  const [players, setPlayers]             = useState<PitchPlayer[]>([])
  // undefined = still loading; null = no active match; string = matchId
  const [activeMatchId, setActiveMatchId] = useState<string | null | undefined>(undefined)
  const [isCaptain, setIsCaptain]         = useState(false)
  const [loading, setLoading]             = useState(true)

  useEffect(() => {
    const load = async () => {
      const [usersSnap, configSnap, matchesSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDoc(doc(db, 'config', 'appConfig')),
        getDocs(query(
          collection(db, 'matches'),
          where('status', 'in', ['registration_r1', 'registration_r2', 'drafting', 'ready']),
        )),
      ])

      const thresholds: CardThresholds = (configSnap.exists() && configSnap.data().cardThresholds)
        ? configSnap.data().cardThresholds
        : DEFAULT_THRESHOLDS

      const loadedUsers = (usersSnap.docs
        .map((d) => ({
          uid: d.id,
          ...d.data(),
          attendanceCount: d.data().attendanceCount ?? 0,
          membershipType:  d.data().membershipType  ?? 'none',
        })) as User[])
        .filter((u) => u.displayName)
        .sort((a, b) => b.attendanceCount - a.attendanceCount)

      // Pick the soonest upcoming active match
      type ActiveMatch = { id: string; date?: Date; captainA?: string; captainB?: string }
      const sorted: ActiveMatch[] = matchesSnap.docs
        .map((d) => ({ id: d.id, date: d.data().date?.toDate(), captainA: d.data().captainA, captainB: d.data().captainB }))
        .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0))
      const active = sorted[0] ?? null
      setActiveMatchId(active?.id ?? null)

      if (userProfile && active) {
        setIsCaptain(active.captainA === userProfile.uid || active.captainB === userProfile.uid)
      }

      setPlayers(loadedUsers.map((u): PitchPlayer => ({
        uid: u.uid,
        displayName: u.displayName,
        preferredPositions: u.preferredPositions,
        avatar: u.avatar,
        tier: getCardTier(u.attendanceCount, thresholds),
      })))

      setLoading(false)
    }
    load()
  }, [userProfile])

  const canEdit = isAdmin || isCaptain

  // saveRef: per-match formations/board when active match exists; fallback to global
  const saveRef = useMemo(() => {
    if (activeMatchId === undefined) return null
    return activeMatchId
      ? doc(db, 'matches', activeMatchId, 'formations', 'board')
      : doc(db, 'tactics', 'default')
  }, [activeMatchId])

  const handleReset = async () => {
    if (!saveRef) return
    await setDoc(saveRef, { positions: defaultPositions(players), updatedAt: serverTimestamp() })
  }

  if (loading || !saveRef) return (
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

      <Pitch players={players} saveRef={saveRef} canEdit={canEdit} />

      {/* Tier ring colour guide */}
      <div className="flex items-center gap-3 justify-center">
        <span className="text-muted text-[10px]">出勤圈色：</span>
        {([
          'ring-bronze shadow-[0_0_6px_1px_rgba(184,115,51,0.4)]',
          'ring-silver shadow-[0_0_6px_1px_rgba(168,169,173,0.45)]',
          'ring-gold   shadow-[0_0_6px_1px_rgba(240,180,41,0.5)]',
          'ring-royal  shadow-[0_0_6px_1px_rgba(79,144,225,0.55)]',
        ] as const).map((cls, i) => (
          <div key={i} className={`w-4 h-4 rounded-full ring-[3px] bg-navy ${cls}`} />
        ))}
      </div>
    </div>
  )
}
