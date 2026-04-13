import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, orderBy, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Match, MatchStatus } from '../types'

const STATUS_LABEL: Record<MatchStatus, string> = {
  draft:          '草稿',
  registration_r1:'报名中 R1',
  registration_r2:'报名中 R2',
  drafting:       '选人中',
  ready:          '已就绪',
  completed:      '已结束',
  cancelled:      '已取消',
}

const STATUS_DOT: Record<MatchStatus, string> = {
  draft:          'bg-muted',
  registration_r1:'bg-teal',
  registration_r2:'bg-teal',
  drafting:       'bg-gold animate-pulse',
  ready:          'bg-teal',
  completed:      'bg-surface',
  cancelled:      'bg-red-hot/50',
}

function MatchCard({ match }: { match: Match }) {
  const isOpen = ['registration_r1', 'registration_r2'].includes(match.status)
  const isDone = match.status === 'completed'

  return (
    <Link
      to={`/match/${match.id}`}
      className={`block rounded-2xl border p-4 transition-all duration-150 active:scale-[0.98]
        ${isDone
          ? 'bg-navy/50 border-surface opacity-60'
          : 'bg-navy border-surface hover:border-teal/30'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[match.status]}`} />
            <span className="text-[10px] font-black text-slate uppercase tracking-widest">
              {STATUS_LABEL[match.status]}
            </span>
          </div>
          <p className={`font-bold text-sm ${isDone ? 'text-slate' : 'text-white'}`}>
            {match.date?.toLocaleDateString('zh-CN', {
              month: 'long', day: 'numeric', weekday: 'short',
            })}
            <span className="text-muted font-normal ml-2">
              {match.date?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </p>
          <p className="text-slate text-xs mt-0.5 truncate">{match.location}</p>
        </div>
        {isOpen ? (
          <span className="shrink-0 bg-teal text-pitch text-[10px] font-black uppercase
                           tracking-wide px-3 py-1.5 rounded-full self-start">
            报名 →
          </span>
        ) : !isDone && match.status !== 'draft' ? (
          <span className="shrink-0 text-slate text-sm self-start">→</span>
        ) : null}
      </div>
    </Link>
  )
}

export default function MatchesPage() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDocs(query(collection(db, 'matches'), orderBy('date', 'desc'))).then((snap) => {
      setMatches(snap.docs.map((d) => ({
        id: d.id, ...d.data(),
        date: d.data().date?.toDate(),
        createdAt: d.data().createdAt?.toDate(),
      })) as Match[])
      setLoading(false)
    })
  }, [])

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const upcoming = matches.filter((m) => m.status !== 'completed' && m.status !== 'draft')
  const past     = matches.filter((m) => m.status === 'completed')

  return (
    <div className="space-y-6">
      <h1 className="text-white text-2xl font-black tracking-tight">比赛</h1>

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[10px] font-black text-slate uppercase tracking-widest">即将进行</h2>
          {upcoming.map((m) => <MatchCard key={m.id} match={m} />)}
        </section>
      )}

      {upcoming.length === 0 && past.length === 0 && (
        <div className="bg-navy border border-surface rounded-2xl p-8 text-center">
          <p className="text-slate text-sm">暂无比赛记录</p>
        </div>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[10px] font-black text-slate uppercase tracking-widest">往期</h2>
          {past.map((m) => <MatchCard key={m.id} match={m} />)}
        </section>
      )}
    </div>
  )
}
