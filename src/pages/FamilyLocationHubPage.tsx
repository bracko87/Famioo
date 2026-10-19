import { CheckCircle2, MapPinned } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { LocationPage } from './LocationPage'
import { CheckInPage } from './CheckInPage'

type LocationTab = 'map' | 'checkin'

const tabs: Array<{ id: LocationTab; label: string; icon: typeof MapPinned }> = [
  { id: 'map', label: 'Family Map & Safe Places', icon: MapPinned },
  { id: 'checkin', label: 'Check-In', icon: CheckCircle2 },
]

/** Groups family map, safe places and optional manual check-ins into one module. */
export function FamilyLocationHubPage() {
  const [params, setParams] = useSearchParams()
  const tab: LocationTab = params.get('tab') === 'checkin' ? 'checkin' : 'map'

  return (
    <div className="family-module-hub" aria-label="Family Location & Check-In">
      <nav className="family-module-tabs" aria-label="Family Location sections">
        {tabs.map(item => {
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.id}
              className={tab === item.id ? 'active' : ''}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setParams(item.id === 'map' ? {} : { tab: item.id })}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
      {tab === 'map' && <LocationPage />}
      {tab === 'checkin' && <CheckInPage />}
    </div>
  )
}
