import type { ReactNode } from 'react'

// Callouts and status pills. Calm by default; colour only where it carries meaning:
// a legal hold is solid ink with a lock, a failure is the alert red, "notice" takes the steel accent.
export type SignLevel = 'hold' | 'danger' | 'warning' | 'caution' | 'notice' | 'safe'

const SIGNAL_WORDS: Record<SignLevel, string> = {
  hold: 'LEGAL HOLD',
  danger: 'ACTION BLOCKED',
  warning: 'HEADS UP',
  caution: 'CHECK THIS',
  notice: 'NOTE',
  safe: 'ALL CLEAR',
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function AlertSymbol() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M12 3.5 21.5 20h-19z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </svg>
  )
}

export function CheckSymbol() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="9.2" />
      <path d="m8 12.4 2.7 2.7L16.2 9.3" />
    </svg>
  )
}

export function InfoSymbol() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 11v5.5M12 7.6v.1" />
    </svg>
  )
}

export function LockSymbol() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
      <path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" />
    </svg>
  )
}

function Symbol({ level }: { level: SignLevel }) {
  if (level === 'hold') return <LockSymbol />
  if (level === 'safe') return <CheckSymbol />
  if (level === 'notice') return <InfoSymbol />
  return <AlertSymbol />
}

interface SignProps {
  level: SignLevel
  word?: string
  compact?: boolean
  children: ReactNode
  className?: string
}

export function Sign({ level, word, compact, children, className = '' }: SignProps) {
  return (
    <div className={`sign sign-${level} ${compact ? 'sign-compact' : ''} ${className}`} role="note">
      <div className="sign-band">
        <Symbol level={level} />
        <span>{word ?? SIGNAL_WORDS[level]}</span>
      </div>
      <div className="sign-body">{children}</div>
    </div>
  )
}

export function Chip({
  level,
  children,
  symbol = true,
  title,
}: {
  level: SignLevel | 'plain' | 'solid' | 'ghost'
  children: ReactNode
  symbol?: boolean
  title?: string
}) {
  // Pills stay quiet: only a hold (lock) and a real problem (alert) carry an icon.
  const showSymbol = symbol && (level === 'hold' || level === 'danger')
  return (
    <span className={`chip chip-${level}`} title={title}>
      {showSymbol && <Symbol level={level as SignLevel} />}
      {children}
    </span>
  )
}
