// User
export type UserRole = 'admin' | 'member' | 'guest'
export type MembershipStatus = 'pending' | 'active' | 'expired' | 'rejected'
export type PaymentStatus = 'unpaid' | 'pending_confirmation' | 'paid'

export interface User {
  uid: string
  displayName: string
  phone: string
  avatar?: string
  preferredPositions: string[]
  role: UserRole
  membershipStatus: MembershipStatus
  paymentStatus: PaymentStatus
  createdAt: Date
}

// Match
export type MatchStatus =
  | 'draft'
  | 'registration_r1'
  | 'registration_r2'
  | 'drafting'
  | 'ready'
  | 'completed'

export interface DraftState {
  currentTurn: string // uid of captain whose turn it is
  pickOrder: string[] // alternating captain uids (snake order)
  picks: { uid: string; pickedBy: string; pickNumber: number }[]
}

export interface Match {
  id: string
  date: Date
  location: string
  maxPlayers: number
  status: MatchStatus
  round2Link?: string
  captainA?: string | null
  captainB?: string | null
  draftState?: DraftState
  agreementText: string
  createdAt: Date
}

// Registration
export type RegistrationStatus = 'confirmed' | 'waitlist' | 'promoted' | 'withdrawn'

export interface Registration {
  uid: string
  displayName: string
  registeredAt: Date
  status: RegistrationStatus
  waitlistPosition?: number | null
  promotedAt?: Date | null
  confirmDeadline?: Date | null
  team?: 'A' | 'B' | null
}

// Formation
export interface PlayerPosition {
  x: number
  y: number
}

export interface Formation {
  captainUid: string
  positions: Record<string, PlayerPosition>
  updatedAt: Date
}

// Finance
export type FinanceType = 'income' | 'expense'

export interface Finance {
  id: string
  type: FinanceType
  category: string
  amount: number
  note: string
  linkedUserId?: string | null
  date: Date
  createdAt: Date
}

// Announcement
export interface Announcement {
  id: string
  title: string
  content: string
  pinned: boolean
  createdAt: Date
  updatedAt: Date
}

// Config
export interface AppConfig {
  venmoHandle: string
  annualFeeAmount: number
  paymentWindowOpen: boolean
  waitlistConfirmMinutes: number
  defaultAgreementText: string
}
