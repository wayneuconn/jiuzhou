// User
export type UserRole = 'admin' | 'member' | 'guest'
export type MembershipType = 'annual' | 'per_session' | 'none'

export interface User {
  uid: string
  displayName: string
  phone: string
  avatar?: string
  preferredPositions: string[]
  role: UserRole
  membershipType: MembershipType
  createdAt: Date
}

// Payment
export type PaymentEventType = 'member' | 'event'
export type PaymentEventStatus = 'open' | 'closed'
export type PaymentStatus = 'pending' | 'confirmed'

export interface PaymentEvent {
  id: string
  title: string
  type: PaymentEventType
  annualAmount: number
  perSessionAmount: number
  venmoHandle: string
  status: PaymentEventStatus
  createdAt: Date
}

export interface Payment {
  id: string
  uid: string
  displayName: string
  membershipType: MembershipType
  amount: number
  status: PaymentStatus
  paidAt: Date
  confirmedAt?: Date
  confirmedBy?: string
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
  currentTurn: string
  pickOrder: string[]
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
  season: string
  waitlistConfirmMinutes: number
  defaultAgreementText: string
}
