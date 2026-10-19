import { BadgeCheck, ContactRound, HeartPulse } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { ContactsPage } from './ContactsPage'
import { EmergencyPage } from './EmergencyPage'
import { PickupAuthorizationPage } from './PickupAuthorizationPage'

type ContactsTab = 'directory' | 'emergency' | 'pickups'

const tabs: Array<{ id: ContactsTab; label: string; icon: typeof ContactRound }> = [
  { id: 'directory', label: 'Contacts', icon: ContactRound },
  { id: 'emergency', label: 'Medical & Safety', icon: HeartPulse },
  { id: 'pickups', label: 'Pickups', icon: BadgeCheck },
]

/**
 * One free Family Contacts & Emergency module, retaining the existing data
 * and editing workflows under accessible sub-tabs. Historical deep links are
 * redirected to the appropriate tab in App.tsx.
 */
export function FamilyContactsHubPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: ContactsTab = tabs.some(item => item.id === requested) ? requested as ContactsTab : 'directory'

  return (
    <div className="family-module-hub" aria-label="Family Contacts & Emergency">
      <nav className="family-module-tabs" aria-label="Family Contacts sections">
        {tabs.map(item => {
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.id}
              className={tab === item.id ? 'active' : ''}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setParams(item.id === 'directory' ? {} : { tab: item.id })}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
      {tab === 'directory' && <ContactsPage />}
      {tab === 'emergency' && <EmergencyPage />}
      {tab === 'pickups' && <PickupAuthorizationPage />}
    </div>
  )
}
