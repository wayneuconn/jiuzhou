import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'

declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier
  }
}

const isWeChat = /MicroMessenger/i.test(navigator.userAgent)

export default function LoginPage() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState(localStorage.getItem('jz_phone') ?? '')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const confirmationRef = useRef<ConfirmationResult | null>(null)
  const recaptchaContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => {
      if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear()
        window.recaptchaVerifier = undefined
      }
    }
  }, [])

  const getRecaptcha = () => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(
        auth,
        'recaptcha-container',
        { size: 'invisible' }
      )
    }
    return window.recaptchaVerifier
  }

  const handleSendCode = async () => {
    setError('')
    const normalized = phone.trim().startsWith('+') ? phone.trim() : `+1${phone.trim()}`
    if (normalized.replace(/\D/g, '').length < 10) {
      setError('Please enter a valid US phone number.')
      return
    }
    setLoading(true)
    try {
      const verifier = getRecaptcha()
      const confirmation = await signInWithPhoneNumber(auth, normalized, verifier)
      confirmationRef.current = confirmation
      localStorage.setItem('jz_phone', phone.trim())
      setStep('code')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send code.')
      window.recaptchaVerifier?.clear()
      window.recaptchaVerifier = undefined
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async () => {
    if (!confirmationRef.current) return
    setError('')
    setLoading(true)
    try {
      const result = await confirmationRef.current.confirm(code.trim())
      await ensureUserProfile(result.user.uid, phone.trim())
      navigate('/')
    } catch {
      setError('Invalid verification code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError('')
    setLoading(true)
    try {
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(auth, provider)
      await ensureUserProfile(result.user.uid, result.user.phoneNumber ?? '')
      navigate('/')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed.')
    } finally {
      setLoading(false)
    }
  }

  const ensureUserProfile = async (uid: string, phoneNumber: string) => {
    const ref = doc(db, 'users', uid)
    const snap = await getDoc(ref)
    if (!snap.exists()) {
      await setDoc(ref, {
        displayName: '',
        phone: phoneNumber,
        preferredPositions: [],
        role: 'guest',
        membershipStatus: 'pending',
        paymentStatus: 'unpaid',
        createdAt: serverTimestamp(),
      })
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-700 to-green-900 flex flex-col items-center justify-center px-4">
      <div ref={recaptchaContainerRef} id="recaptcha-container" />

      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-3xl font-bold text-center text-green-700 mb-1">九州</h1>
        <p className="text-center text-gray-500 text-sm mb-8">Football Team Management</p>

        {step === 'phone' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 201 555 0100"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
                onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
              />
              <p className="text-xs text-gray-400 mt-1">US numbers only (+1). We'll send a 6-digit code.</p>
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              onClick={handleSendCode}
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {loading ? 'Sending...' : 'Send Code'}
            </button>

            {!isWeChat && (
              <>
                <div className="relative flex items-center">
                  <div className="flex-1 border-t border-gray-200" />
                  <span className="mx-3 text-xs text-gray-400">or</span>
                  <div className="flex-1 border-t border-gray-200" />
                </div>
                <button
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full border border-gray-300 hover:bg-gray-50 disabled:opacity-50 font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/>
                    <path fill="#34A853" d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.615 24 12.255 24z"/>
                    <path fill="#FBBC05" d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"/>
                    <path fill="#EA4335" d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.64 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/>
                  </svg>
                  Continue with Google
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Verification Code
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                maxLength={6}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-2xl tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-green-500"
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-1">Sent to {phone}</p>
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              onClick={handleVerifyCode}
              disabled={loading || code.length < 6}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <button
              onClick={() => { setStep('phone'); setCode(''); setError('') }}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
