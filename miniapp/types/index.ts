export type UserRole = 'admin' | 'member' | 'guest'
export type MembershipType = 'annual' | 'per_session' | 'none'
export type CardTier = 'blue' | 'gold' | 'silver' | 'bronze' | 'none'

export interface CardThresholds {
  bronze: number
  silver: number
  gold: number
  blue: number
}

export interface User {
  uid: string
  openid?: string
  displayName: string
  phone: string
  avatar?: string
  preferredPositions: string[]
  role: UserRole
  membershipType: MembershipType
  attendanceCount: number
  lateCount: number
  dangerousCount: number
  createdAt: number
}

export type PaymentEventType = 'member' | 'event'
export type PaymentEventStatus = 'open' | 'closed'
export type PaymentStatus = 'pending' | 'confirmed'

export interface PaymentEvent {
  id: string
  title: string
  type: PaymentEventType
  annualAmount: number
  perSessionAmount: number
  status: PaymentEventStatus
  createdAt: number
}

export interface Payment {
  id: string
  uid: string
  displayName: string
  membershipType: MembershipType
  amount: number
  status: PaymentStatus
  paidAt: number
  confirmedAt?: number
  confirmedBy?: string
}

export type MatchStatus =
  | 'draft'
  | 'registration_r1'
  | 'registration_r2'
  | 'drafting'
  | 'ready'
  | 'completed'
  | 'cancelled'

export interface DraftState {
  currentTurn: string
  pickOrder: string[]
  picks: { uid: string; pickedBy: string; pickNumber: number }[]
}

export interface Match {
  id: string
  date: number
  location: string
  maxPlayers: number
  status: MatchStatus
  round2Link?: string
  captainA?: string | null
  captainB?: string | null
  draftState?: DraftState
  agreementText: string
  createdAt: number
}

export type RegistrationStatus = 'confirmed' | 'waitlist' | 'promoted' | 'withdrawn' | 'excused'
export type PaymentSessionStatus = 'pending' | 'confirmed'
export type MatchTag = 'late' | 'dangerous'

export interface Registration {
  uid: string
  displayName: string
  preferredPositions?: string[]
  registeredAt: number
  status: RegistrationStatus
  waitlistPosition?: number | null
  promotedAt?: number | null
  confirmDeadline?: number | null
  autoAccept?: boolean
  team?: 'A' | 'B' | null
  paymentStatus?: PaymentSessionStatus | null
  tags?: MatchTag[]
}

export interface PlayerPosition {
  x: number
  y: number
}

export interface Formation {
  captainUid: string
  positions: Record<string, PlayerPosition>
  updatedAt: number
}

export interface Announcement {
  id: string
  title: string
  content: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface AppConfig {
  season: string
  cardThresholds: CardThresholds
  waitlistConfirmMinutes: number
  defaultAgreementText: string
  defaultAnnouncement: string
  perSessionFee: number
}
