import { useState, useEffect } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/authStore'

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']

export default function ProfilePage() {
  const { userProfile } = useAuthStore()
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
    setPositions((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]
    )
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

  if (!userProfile) return null

  const statusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
    rejected: 'bg-red-100 text-red-700',
    expired: 'bg-gray-100 text-gray-600',
  }

  const paymentColor: Record<string, string> = {
    paid: 'bg-green-100 text-green-700',
    pending_confirmation: 'bg-yellow-100 text-yellow-700',
    unpaid: 'bg-red-100 text-red-700',
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800">My Profile</h1>

      {/* Status badges */}
      <div className="flex gap-2 flex-wrap">
        <span className={`text-xs font-medium px-3 py-1 rounded-full ${statusColor[userProfile.membershipStatus]}`}>
          {userProfile.membershipStatus}
        </span>
        <span className={`text-xs font-medium px-3 py-1 rounded-full ${paymentColor[userProfile.paymentStatus]}`}>
          {userProfile.paymentStatus.replace('_', ' ')}
        </span>
        <span className="text-xs font-medium px-3 py-1 rounded-full bg-gray-100 text-gray-600">
          {userProfile.role}
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Preferred Positions</label>
          <div className="flex flex-wrap gap-2">
            {POSITIONS.map((pos) => (
              <button
                key={pos}
                onClick={() => togglePosition(pos)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  positions.includes(pos)
                    ? 'bg-green-600 border-green-600 text-white'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Phone</label>
          <p className="text-gray-600">{userProfile.phone}</p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !displayName.trim()}
          className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
