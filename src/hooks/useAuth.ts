import { useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { useAuthStore } from '../stores/authStore'
import type { User } from '../types'

export function useAuthInit() {
  const { setFirebaseUser, setUserProfile, setLoading } = useAuthStore()

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setFirebaseUser(firebaseUser)

      if (!firebaseUser) {
        setUserProfile(null)
        setLoading(false)
        return
      }

      const unsubProfile = onSnapshot(
        doc(db, 'users', firebaseUser.uid),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data()
            setUserProfile({
              uid: firebaseUser.uid,
              displayName: data.displayName,
              phone: data.phone,
              avatar: data.avatar,
              preferredPositions: data.preferredPositions ?? [],
              role: data.role,
              membershipType: data.membershipType ?? 'none',
              attendanceCount: data.attendanceCount ?? 0,
              createdAt: data.createdAt?.toDate(),
            } as User)
          } else {
            setUserProfile(null)
          }
          setLoading(false)
        },
        () => setLoading(false)
      )

      return unsubProfile
    })

    return unsubAuth
  }, [setFirebaseUser, setUserProfile, setLoading])
}
