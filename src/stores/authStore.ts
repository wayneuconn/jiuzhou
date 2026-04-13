import { create } from 'zustand'
import type { User as FirebaseUser } from 'firebase/auth'
import type { User } from '../types'

const CACHE_KEY = 'jz_profile'

function loadCache(): User | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p.createdAt) p.createdAt = new Date(p.createdAt)
    return p as User
  } catch { return null }
}

function saveCache(profile: User | null) {
  if (profile) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(profile))
  } else {
    localStorage.removeItem(CACHE_KEY)
  }
}

const cached = loadCache()

interface AuthState {
  firebaseUser: FirebaseUser | null
  userProfile: User | null
  loading: boolean
  setFirebaseUser: (user: FirebaseUser | null) => void
  setUserProfile: (profile: User | null) => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  firebaseUser: null,
  userProfile: cached,
  loading: !cached, // cached profile → skip spinner on tab restore
  setFirebaseUser: (user) => set({ firebaseUser: user }),
  setUserProfile: (profile) => {
    saveCache(profile)
    set({ userProfile: profile })
  },
  setLoading: (loading) => set({ loading }),
}))
