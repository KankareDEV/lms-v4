import { useEffect, useState } from 'react'
import { initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// --- Firebase config ---
const cfg = {
  apiKey: "AIzaSyCkfKheIW4k01BCNc8QyVc-scJu8CmaPYA",
  authDomain: "nordwest-lms.firebaseapp.com",
  projectId: "nordwest-lms",
  storageBucket: "nordwest-lms.firebasestorage.app", 
  messagingSenderId: "620143317939",
  appId: "1:620143317939:web:9cf47336b5e377c73731c6",
}

// --- Init ---
const app = initializeApp(cfg)
export const auth = getAuth(app)
export const db   = getFirestore(app)
export const storage = getStorage(app)  

// --- Auth hook ---
export function useAuthState() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  return {
    user,
    loading,
    signOut: () => fbSignOut(auth),
  }
}
