export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={['brand-mark', className].filter(Boolean).join(' ')} aria-hidden="true">
      <img src="/famioo-logo-white.svg" alt="" />
    </span>
  )
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'brand brand-compact' : 'brand'}>
      <BrandMark />
      <span className="brand-copy">
        <strong>Famioo</strong>
        {!compact && <small>Family life, organized.</small>}
      </span>
    </div>
  )
}
