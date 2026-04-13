import type { CardTier, CardThresholds } from '../types'

export const DEFAULT_THRESHOLDS: CardThresholds = {
  bronze: 1,
  silver: 5,
  gold:   15,
  blue:   30,
}

export function getCardTier(count: number, thresholds: CardThresholds): CardTier {
  if (count >= thresholds.blue)   return 'blue'
  if (count >= thresholds.gold)   return 'gold'
  if (count >= thresholds.silver) return 'silver'
  if (count >= thresholds.bronze) return 'bronze'
  return 'none'
}

// Returns how many more games to the next tier, and the color of that tier.
// Returns null if already at max tier.
export function getNextTierProgress(
  count: number,
  thresholds: CardThresholds,
): { gamesLeft: number; colorClass: string } | null {
  if (count >= thresholds.blue) return null
  if (count >= thresholds.gold)   return { gamesLeft: thresholds.blue   - count, colorClass: 'text-royal' }
  if (count >= thresholds.silver) return { gamesLeft: thresholds.gold   - count, colorClass: 'text-gold'  }
  if (count >= thresholds.bronze) return { gamesLeft: thresholds.silver - count, colorClass: 'text-silver' }
  return                                 { gamesLeft: thresholds.bronze - count, colorClass: 'text-bronze' }
}

export const TIER_BORDER: Record<CardTier, string> = {
  blue:   'border-royal shadow-royal/30',
  gold:   'border-gold  shadow-gold/30',
  silver: 'border-silver shadow-silver/20',
  bronze: 'border-bronze shadow-bronze/20',
  none:   'border-surface shadow-none',
}

export const TIER_TEXT: Record<CardTier, string> = {
  blue:   'text-royal',
  gold:   'text-gold',
  silver: 'text-silver',
  bronze: 'text-bronze',
  none:   'text-slate',
}

// Rings made thicker (ring-[3px]) and with a background glow for visibility on the pitch
export const TIER_RING: Record<CardTier, string> = {
  blue:   'ring-[3px] ring-royal   shadow-[0_0_8px_2px_rgba(79,144,225,0.6)]',
  gold:   'ring-[3px] ring-gold    shadow-[0_0_8px_2px_rgba(240,180,41,0.55)]',
  silver: 'ring-[3px] ring-silver  shadow-[0_0_6px_2px_rgba(168,169,173,0.5)]',
  bronze: 'ring-[3px] ring-bronze  shadow-[0_0_6px_2px_rgba(184,115,51,0.45)]',
  none:   'ring-2 ring-white/20',
}
