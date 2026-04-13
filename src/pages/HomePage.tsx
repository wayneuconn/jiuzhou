import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Announcement, Match } from '../types'

export default function HomePage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [nextMatch, setNextMatch] = useState<Match | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [annSnap, matchSnap] = await Promise.all([
        getDocs(query(collection(db, 'announcements'), orderBy('pinned', 'desc'), orderBy('createdAt', 'desc'), limit(5))),
        getDocs(query(collection(db, 'matches'), where('status', 'in', ['registration_r1', 'registration_r2', 'drafting', 'ready']), orderBy('date', 'asc'), limit(1))),
      ])
      setAnnouncements(annSnap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate(), updatedAt: d.data().updatedAt?.toDate() })) as Announcement[])
      if (!matchSnap.empty) {
        const d = matchSnap.docs[0]
        setNextMatch({ id: d.id, ...d.data(), date: d.data().date?.toDate(), createdAt: d.data().createdAt?.toDate() } as Match)
      }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      {/* Next Match Card */}
      {nextMatch ? (
        <Link to={`/match/${nextMatch.id}`} className="block bg-green-600 rounded-2xl p-5 text-white shadow-lg">
          <p className="text-green-200 text-xs font-semibold uppercase tracking-wide mb-1">Next Match</p>
          <p className="text-xl font-bold">
            {nextMatch.date?.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
          <p className="text-green-100 text-sm mt-0.5">{nextMatch.location}</p>
          <div className="mt-3 inline-flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1 text-sm">
            <span className="capitalize">{nextMatch.status.replace('_', ' ')}</span>
            <span>→</span>
          </div>
        </Link>
      ) : (
        <div className="bg-gray-100 rounded-2xl p-5 text-center text-gray-400 text-sm">
          No upcoming matches scheduled.
        </div>
      )}

      {/* Announcements */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Announcements</h2>
        {announcements.length === 0 ? (
          <p className="text-gray-400 text-sm">No announcements yet.</p>
        ) : (
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-gray-800">{a.title}</p>
                  {a.pinned && (
                    <span className="shrink-0 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Pinned</span>
                  )}
                </div>
                <p className="text-gray-600 text-sm mt-1 whitespace-pre-wrap">{a.content}</p>
                <p className="text-gray-400 text-xs mt-2">
                  {a.createdAt?.toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
