export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={['brand-mark', className].filter(Boolean).join(' ')} aria-hidden="true">
      <i className="brand-petal brand-petal-purple" />
      <i className="brand-petal brand-petal-pink" />
      <i className="brand-petal brand-petal-green" />
      <i className="brand-petal brand-petal-cyan" />
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
