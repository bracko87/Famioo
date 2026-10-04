import { useLocation } from 'react-router-dom'

export function ModulePlaceholderPage() {
  const location = useLocation()
  const slug = location.pathname.split('/').pop() ?? 'module'
  const label = slug.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">FAMIOO MODULE</span>
          <h1>{label}</h1>
          <p>This route exists, but the module will only be built after the core milestone is stable.</p>
        </div>
      </section>
      <div className="list-card empty-state">
        <strong>Clean foundation ready.</strong>
        <span>No legacy Dayora implementation is copied into this module.</span>
      </div>
    </div>
  )
}
