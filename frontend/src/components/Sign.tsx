import type { ReactNode } from 'react'

export type SignLevel = 'danger' | 'warning' | 'caution' | 'notice' | 'safe'

const SIGNAL_WORDS: Record<SignLevel, string> = {
  danger: 'DANGER',
  warning: 'WARNING',
  caution: 'CAUTION',
  notice: 'NOTICE',
  safe: 'SAFE',
}

// ANSI safety alert symbol: a triangle with an exclamation mark. Drawn, not a glyph.
// On light bands (warning, caution) the triangle is black and the mark takes the band colour.
export function AlertSymbol({ inverse = false }: { inverse?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5 23 21.5H1z" fill={inverse ? '#000' : '#fff'} />
      <g className={inverse ? 'alert-mark-inverse' : 'alert-mark'}>
        <rect x="10.6" y="8.6" width="2.8" height="6.8" />
        <rect x="10.6" y="16.8" width="2.8" height="2.6" />
      </g>
    </svg>
  )
}

export function CheckSymbol() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#fff" />
      <path d="m6.5 12.5 3.6 3.6 7.4-8" fill="none" stroke="#000" strokeWidth="2.8" strokeLinecap="square" />
    </svg>
  )
}

export function InfoSymbol() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#fff" />
      <rect x="10.6" y="10" width="2.8" height="8" fill="#000" />
      <rect x="10.6" y="5.6" width="2.8" height="2.8" fill="#000" />
    </svg>
  )
}

function Symbol({ level }: { level: SignLevel }) {
  if (level === 'safe') return <CheckSymbol />
  if (level === 'notice') return <InfoSymbol />
  // Black-on-colour bands (warning, caution) use a black triangle with a white mark.
  return <AlertSymbol inverse={level === 'warning' || level === 'caution'} />
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
  const showSymbol = symbol && level !== 'plain' && level !== 'solid' && level !== 'ghost'
  return (
    <span className={`chip chip-${level}`} title={title}>
      {showSymbol && <Symbol level={level as SignLevel} />}
      {children}
    </span>
  )
}
