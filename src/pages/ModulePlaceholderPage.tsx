import { useLocation } from 'react-router-dom'

export function ModulePlaceholderPage() {
  const location = useLocation()
  const slug = location.pathname.split('/').pop() ?? 'module'
  const label = slug.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

  return (
    <div className="page">
      <div className="page-label">{label.toUpperCase()}</div>

      <div className="list-card empty-state module-placeholder-card">
        <strong>{label}</strong>
        <span>This Famioo module is reserved in the product structure and will be connected here when implemented.</span>
      </div>
    </div>
  )
}
