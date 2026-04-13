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

export const TIER_LABEL: Record<CardTier, string> = {
  blue:   '蓝卡',
  gold:   '金卡',
  silver: '银卡',
  bronze: '铜卡',
  none:   '',
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

export const TIER_RING: Record<CardTier, string> = {
  blue:   'ring-2 ring-royal',
  gold:   'ring-2 ring-gold',
  silver: 'ring-2 ring-silver',
  bronze: 'ring-2 ring-bronze',
  none:   'ring-1 ring-surface',
}
