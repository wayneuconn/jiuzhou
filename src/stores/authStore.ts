import { create } from 'zustand'
import type { User as FirebaseUser } from 'firebase/auth'
import type { User } from '../types'

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
  userProfile: null,
  loading: true,
  setFirebaseUser: (user) => set({ firebaseUser: user }),
  setUserProfile: (profile) => set({ userProfile: profile }),
  setLoading: (loading) => set({ loading }),
}))
