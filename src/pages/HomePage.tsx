import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, orderBy, limit, getDocs, where, doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import Markdown from '../components/Markdown'
import type { Announcement, Match } from '../types'

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Module-level cache: persists across in-session tab switches without re-fetching
let _cache: {
  announcements: Announcement[]
  nextMatch: Match | null
  season: string
  defaultAnnouncement: string
} | null = null

export default function HomePage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>(_cache?.announcements ?? [])
  const [nextMatch, setNextMatch] = useState<Match | null>(_cache?.nextMatch ?? null)
  const [season, setSeason] = useState(_cache?.season ?? '')
  const [defaultAnnouncement, setDefaultAnnouncement] = useState(_cache?.defaultAnnouncement ?? '')
  const [loading, setLoading] = useState(!_cache)

  useEffect(() => {
    const load = async () => {
      const [annSnap, matchSnap, configSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'announcements'),
          orderBy('pinned', 'desc'),
          orderBy('createdAt', 'desc'),
          limit(5)
        )),
        getDocs(query(
          collection(db, 'matches'),
          where('status', 'in', ['registration_r1', 'registration_r2', 'drafting', 'ready']),
          orderBy('date', 'asc'),
          limit(1)
        )),
        getDoc(doc(db, 'config', 'appConfig')),
      ])
      const newSeason = configSnap.exists() ? (configSnap.data().season ?? '') : ''
      const newDefaultAnn = configSnap.exists() ? (configSnap.data().defaultAnnouncement ?? '') : ''
      const newAnnouncements = annSnap.docs.map((d) => ({
        id: d.id, ...d.data(),
        createdAt: d.data().createdAt?.toDate(),
        updatedAt: d.data().updatedAt?.toDate(),
      })) as Announcement[]
      const newNextMatch = matchSnap.empty ? null : (() => {
        const d = matchSnap.docs[0]
        return { id: d.id, ...d.data(), date: d.data().date?.toDate(), createdAt: d.data().createdAt?.toDate() } as Match
      })()

      _cache = { announcements: newAnnouncements, nextMatch: newNextMatch, season: newSeason, defaultAnnouncement: newDefaultAnn }
      setSeason(newSeason)
      setDefaultAnnouncement(newDefaultAnn)
      setAnnouncements(newAnnouncements)
      setNextMatch(newNextMatch)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-black tracking-tight">九州</h1>
          <p className="text-slate text-xs tracking-[0.25em] uppercase mt-0.5">Football Team</p>
        </div>
        {season && (
          <span className="text-[10px] font-black text-gold border border-gold/30 bg-gold/10
                           px-2.5 py-1 rounded-full uppercase tracking-widest">
            {season} Season
          </span>
        )}
      </div>

      {/* Next Match Hero Card */}
      {nextMatch ? (
        <Link
          to={`/match/${nextMatch.id}`}
          className="block relative overflow-hidden rounded-2xl border border-teal/25
                     bg-gradient-to-br from-[#0f2320] to-navy shadow-xl shadow-black/60"
        >
          <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
          <div className="relative p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-black text-teal uppercase tracking-widest">
                Next Match
              </span>
              <span className="text-[10px] font-bold text-slate capitalize">
                {nextMatch.status.replace(/_/g, ' ')}
              </span>
            </div>

            <p className="text-white text-2xl font-black tracking-tight leading-tight">
              {nextMatch.date?.toLocaleDateString('en-US', {
                weekday: 'long', month: 'short', day: 'numeric'
              })}
            </p>
            <p className="text-slate text-sm mt-1">{nextMatch.location}</p>

            <div className="flex items-center justify-between mt-5">
              <span className="bg-teal text-pitch text-xs font-black uppercase tracking-wide
                               px-4 py-1.5 rounded-full">
                Sign Up →
              </span>
            </div>
          </div>
        </Link>
      ) : (
        <div className="bg-navy border border-surface rounded-2xl p-6 text-center">
          <p className="text-slate text-sm">暂无即将进行的比赛</p>
        </div>
      )}

      {/* Announcements */}
      <section>
        <h2 className="text-[10px] font-black text-slate uppercase tracking-widest mb-3">
          公告
        </h2>
        {announcements.length === 0 ? (
          defaultAnnouncement ? (
            <div className="bg-navy border border-surface rounded-2xl p-4">
              <Markdown>{defaultAnnouncement}</Markdown>
            </div>
          ) : (
            <p className="text-muted text-sm">暂无公告</p>
          )
        ) : (
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="bg-navy border border-surface rounded-2xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-white font-bold text-sm leading-snug">{a.title}</p>
                  {a.pinned && (
                    <span className="shrink-0 text-[10px] font-black text-gold border border-gold/30
                                     bg-gold/10 px-2 py-0.5 rounded-full uppercase tracking-wide">
                      置顶
                    </span>
                  )}
                </div>
                <Markdown>{a.content}</Markdown>
                <p className="text-muted text-xs">{a.createdAt?.toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
