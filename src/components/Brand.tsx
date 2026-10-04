export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'brand brand-compact' : 'brand'}>
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="brand-copy">
        <strong>Famioo</strong>
        {!compact && <small>Family life, organized.</small>}
      </span>
    </div>
  )
}
