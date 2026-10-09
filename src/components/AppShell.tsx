import {
  BadgeAlert,
  AudioLines,
  BadgeCheck,
  Bell,
  CalendarDays,
  CarFront,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  ContactRound,
  FileText,
  FolderKanban,
  GraduationCap,
  Home,
  House,
  Images,
  LogOut,
  MapPinned,
  Menu,
  MessageCircle,
  MessagesSquare,
  PawPrint,
  Plane,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RadioTower,
  Receipt,
  ScanLine,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  StickyNote,
  Syringe,
  Ticket,
  Utensils,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import type { ModuleCode } from '../lib/types'
import { Brand } from './Brand'
import { FooterWeather } from './FooterWeather'
import { Select } from './ui/Select'
import { MobileAssistantQuick } from './MobileAssistantQuick'
import { MobileMessengerQuick } from './MobileMessengerQuick'
import { LocationSharingAgent } from './LocationSharingAgent'

const iconByModule: Partial<Record<ModuleCode, ComponentType<{ size?: number }>>> = {
  calendar: CalendarDays,
  tasks: ClipboardList,
  checklists: CheckSquare,
  shopping: ShoppingBag,
  costs: Receipt,
  school: GraduationCap,
  home_care: House,
  life_admin: FileText,
  projects: FolderKanban,
  meals: Utensils,
  files: FileText,
  assistant: Sparkles,
  vaccinations: Syringe,
  tickets: Ticket,
  safety: ShieldAlert,
  location: MapPinned,
  messenger: MessageCircle,
  contacts: ContactRound,
  memo: StickyNote,
  travel: Plane,
  vehicles: CarFront,
  pets: PawPrint,
  inbox_scan: ScanLine,
  emergency_info: BadgeAlert,
  calendar_context: MessagesSquare,
  memories: Images,
  checkin: CheckCircle2,
  pickup_authorization: BadgeCheck,
  home_remote: RadioTower,
  voice_integration: AudioLines,
}

const routeByModule: Partial<Record<ModuleCode, string>> = {
  shopping: '/app/shopping',
  costs: '/app/costs',
  school: '/app/school',
  home_care: '/app/home-care',
  life_admin: '/app/life-admin',
  projects: '/app/projects',
  meals: '/app/meals',
  files: '/app/files',
  assistant: '/app/assistant',
  vaccinations: '/app/vaccinations',
  tickets: '/app/tickets',
  safety: '/app/safety',
  location: '/app/location',
  messenger: '/app/messenger',
  contacts: '/app/contacts',
  memo: '/app/memo',
  travel: '/app/travel',
  vehicles: '/app/vehicles',
  pets: '/app/pets',
  inbox_scan: '/app/inbox',
  emergency_info: '/app/emergency',
  calendar_context: '/app/calendar',
  memories: '/app/memories',
  checkin: '/app/check-in',
  pickup_authorization: '/app/pickup-authorization',
  home_remote: '/app/home-remote',
  voice_integration: '/app/voice',
}


type SidebarModuleItem = {
  code: ModuleCode
  label: string
  category: 'plan' | 'family' | 'life' | 'connected'
}

const sidebarModuleItems: SidebarModuleItem[] = [
  { code: 'calendar', label: 'Calendar', category: 'plan' },
  { code: 'tasks', label: 'Tasks', category: 'plan' },
  { code: 'checklists', label: 'Checklists', category: 'plan' },
  { code: 'memo', label: 'Memo / Someday', category: 'plan' },
  { code: 'inbox_scan', label: 'Inbox / Scan', category: 'plan' },

  { code: 'safety', label: 'Family Safety', category: 'family' },
  { code: 'location', label: 'Family Location', category: 'family' },
  { code: 'messenger', label: 'Family Messenger', category: 'family' },
  { code: 'contacts', label: 'Family Contacts', category: 'family' },
  { code: 'memories', label: 'Memories', category: 'family' },
  { code: 'checkin', label: 'Check-In', category: 'family' },
  { code: 'pickup_authorization', label: 'Pickup Authorization', category: 'family' },
  { code: 'emergency_info', label: 'Emergency Info', category: 'family' },
  { code: 'school', label: 'School & Kita', category: 'family' },

  { code: 'shopping', label: 'Shopping', category: 'life' },
  { code: 'costs', label: 'Household Costs', category: 'life' },
  { code: 'meals', label: 'Meals & Recipes', category: 'life' },
  { code: 'home_care', label: 'Home Care', category: 'life' },
  { code: 'life_admin', label: 'Life Admin', category: 'life' },
  { code: 'projects', label: 'Projects, Chores & Rewards', category: 'life' },
  { code: 'travel', label: 'Travel & Trips', category: 'life' },
  { code: 'vehicles', label: 'Vehicles', category: 'life' },
  { code: 'pets', label: 'Pets', category: 'life' },
  { code: 'files', label: 'Files', category: 'life' },
  { code: 'vaccinations', label: 'Prevention', category: 'life' },
  { code: 'tickets', label: 'Tickets / QR Wallet', category: 'life' },

  { code: 'assistant', label: 'AI Assistant', category: 'connected' },
  { code: 'home_remote', label: 'Home Remote', category: 'connected' },
  { code: 'voice_integration', label: 'Alexa / Voice', category: 'connected' },
]

const sidebarCategories = [
  { id: 'plan' as const, label: 'Plan' },
  { id: 'family' as const, label: 'Family' },
  { id: 'life' as const, label: 'Home & Life' },
  { id: 'connected' as const, label: 'Connected' },
]

type HeaderNotification = {
  id: string
  notification_type: string
  title: string
  body: string
  entity_type: string | null
  entity_id: string | null
  status: 'pending' | 'sent' | 'read' | 'failed' | 'cancelled'
  created_at: string
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { household, households, modules, profiles, user, switchHousehold } = useHousehold()
  const [mobileMenu, setMobileMenu] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('famioo.sidebar.collapsed') === '1'
    } catch {
      return false
    }
  })
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [openSidebarCategory, setOpenSidebarCategory] = useState<string>('')
  const [notifications, setNotifications] = useState<HeaderNotification[]>([])
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('')
  const visibleSidebarModules = useMemo(() => {
    const enabledCodes = new Set(modules.filter((module) => module.enabled).map((module) => module.code))
    return sidebarModuleItems.filter((item) => enabledCodes.has(item.code) && routeByModule[item.code])
  }, [modules])
  const useCategorizedSidebar = visibleSidebarModules.length > 15

  const currentProfile = profiles.find((profile) => profile.linked_user_id === user.id)
  const profileName = currentProfile?.display_name
    ?? (user.user_metadata?.display_name as string | undefined)
    ?? user.email?.split('@')[0]
    ?? 'Profile'
  const profileMark = currentProfile?.avatar_emoji ?? profileName.slice(0, 1).toUpperCase()
  const unreadCount = notifications.filter((item) => item.status === 'sent').length

  useEffect(() => {
    window.scrollTo({ top:0,left:0,behavior:'auto' })
    document.documentElement.scrollTop=0
    document.body.scrollTop=0
  },[location.pathname])

  useEffect(() => {
    const savedTheme=window.localStorage.getItem('famioo.mobile.theme') === 'dark' ? 'dark' : 'light'
    document.documentElement.dataset.famiooTheme=savedTheme
  }, [])

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem('famioo.sidebar.collapsed', next ? '1' : '0')
      } catch {
        // The preference is optional; the sidebar still works without storage.
      }
      return next
    })
  }

  async function loadNotifications() {
    const result = await supabase
      .from('notifications')
      .select('id,notification_type,title,body,entity_type,entity_id,status,created_at')
      .eq('household_id', household.id)
      .eq('recipient_user_id', user.id)
      .in('status', ['sent', 'read'])
      .order('created_at', { ascending: false })
      .limit(6)

    if (!result.error) setNotifications((result.data ?? []) as HeaderNotification[])
  }

  useEffect(() => {
    void loadNotifications()
    const timer=window.setInterval(()=>{ void loadNotifications() },5000)
    return ()=>window.clearInterval(timer)
  }, [household.id, user.id])

  useEffect(() => {
    setProfileAvatarUrl('')

    if (!currentProfile?.avatar_path) return

    void supabase.storage
      .from('profile-avatars')
      .createSignedUrl(currentProfile.avatar_path, 3600)
      .then(({ data }) => {
        setProfileAvatarUrl(data?.signedUrl ?? '')
      })
  }, [currentProfile?.avatar_path])

  async function openNotifications() {
    const nextOpen = !notificationOpen
    setNotificationOpen(nextOpen)

    if (!nextOpen) return

    const unreadIds = notifications
      .filter((item) => item.status === 'sent')
      .map((item) => item.id)

    if (unreadIds.length) {
      const result = await supabase
        .from('notifications')
        .update({ status: 'read', read_at: new Date().toISOString() })
        .in('id', unreadIds)

      if (!result.error) {
        setNotifications((current) => current.map((item) => (
          unreadIds.includes(item.id) ? { ...item, status: 'read' } : item
        )))
      }
    }
  }

  return (
    <div className={sidebarCollapsed ? 'app-layout sidebar-collapsed' : 'app-layout'}>
      <LocationSharingAgent />
      <aside className={[
        'app-sidebar',
        mobileMenu ? 'open' : '',
        sidebarCollapsed ? 'collapsed' : '',
      ].filter(Boolean).join(' ')}>
        <div className="sidebar-top">
          <Brand />
          <button className="icon-button mobile-sidebar-close" onClick={() => setMobileMenu(false)} aria-label="Close menu">
            <X size={19} />
          </button>
        </div>

        <button
          className="desktop-sidebar-toggle"
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        </button>

        <nav className={'side-nav '+(useCategorizedSidebar?'side-nav-categorized':'side-nav-flat')} aria-label="Main navigation">
          <span className="nav-label">{useCategorizedSidebar ? 'MODULES' : 'PLAN'}</span>
          <NavLink to="/app" end onClick={() => setMobileMenu(false)} title="Home"><Home size={18} /><span className="nav-text">Home</span></NavLink>

          <div className="sidebar-flat-modules">
            {visibleSidebarModules.map((item) => {
              const Icon = iconByModule[item.code] ?? Sparkles
              const route = routeByModule[item.code]
              if (!route) return null
              return <NavLink to={route} key={item.code} onClick={() => setMobileMenu(false)} title={item.label}><Icon size={18} /><span className="nav-text">{item.label}</span></NavLink>
            })}
          </div>

          <div className="sidebar-category-modules">
            {sidebarCategories.map((category) => {
              const items = visibleSidebarModules.filter((item) => item.category === category.id)
              if (!items.length) return null
              const open = openSidebarCategory === category.id
              return (
                <section className={open ? 'sidebar-module-group open' : 'sidebar-module-group'} key={category.id}>
                  <button
                    type="button"
                    className="sidebar-module-group-toggle"
                    onClick={() => setOpenSidebarCategory((current) => current === category.id ? '' : category.id)}
                    aria-expanded={open}
                  >
                    <span>{category.label}</span>
                    <small>{items.length}</small>
                    <ChevronDown size={15} />
                  </button>
                  <div className="sidebar-module-group-links">
                    {items.map((item) => {
                      const Icon = iconByModule[item.code] ?? Sparkles
                      const route = routeByModule[item.code]
                      if (!route) return null
                      return <NavLink to={route} key={item.code} onClick={() => setMobileMenu(false)} title={item.label}><Icon size={18} /><span className="nav-text">{item.label}</span></NavLink>
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </nav>

        <nav className="side-nav side-nav-bottom">
          <NavLink to="/app/settings" onClick={() => setMobileMenu(false)} title="Settings"><Settings size={18} /><span className="nav-text">Settings</span></NavLink>
          <button onClick={() => void supabase.auth.signOut()} title="Sign out"><LogOut size={18} /><span className="nav-text">Sign out</span></button>
        </nav>
      </aside>

      {mobileMenu && <button className="sidebar-backdrop" onClick={() => setMobileMenu(false)} aria-label="Close navigation" />}

      <header className="app-header">
        <button className="icon-button mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label="Open menu">
          <Menu size={20} />
        </button>

        <div className="header-household">
          <span>Household</span>
          {households.length > 1 ? (
            <Select
              className="header-household-select"
              value={household.id}
              onChange={(value) => void switchHousehold(value)}
              options={households.map((item) => ({ value: item.id, label: item.name }))}
              ariaLabel="Choose household"
            />
          ) : <strong>{household.name}</strong>}
        </div>

        <div className="header-actions">
          <div className="notification-control">
            <button
              className="header-notification-button"
              type="button"
              aria-label="Notifications"
              aria-expanded={notificationOpen}
              onClick={() => void openNotifications()}
            >
              <Bell size={17} />
              <span>Notifications</span>
              {unreadCount > 0 && <b>{unreadCount > 9 ? '9+' : unreadCount}</b>}
            </button>

            {notificationOpen && (
              <div className="notification-popover">
                <div className="notification-popover-head">
                  <strong>Notifications</strong>
                  <small>{notifications.length ? 'Latest household updates' : 'Nothing new'}</small>
                </div>
                <div className="notification-popover-list">
                  {notifications.length === 0 ? (
                    <div className="notification-empty">No notifications yet.</div>
                  ) : notifications.map((item) => {
                    const content=(
                      <>
                        <span className={item.status === 'read' ? 'read' : ''} />
                        <div>
                          <strong>{item.title}</strong>
                          <p>{item.body}</p>
                          <small>{new Date(item.created_at).toLocaleString()}</small>
                        </div>
                      </>
                    )

                    if(item.notification_type.startsWith('safety_')){
                      return (
                        <NavLink
                          className="notification-item safety-notification-item"
                          to="/app/safety"
                          key={item.id}
                          onClick={()=>setNotificationOpen(false)}
                        >
                          {content}
                        </NavLink>
                      )
                    }

                    if(item.notification_type.startsWith('location_')){
                      return (
                        <NavLink
                          className="notification-item location-notification-item"
                          to="/app/location"
                          key={item.id}
                          onClick={()=>setNotificationOpen(false)}
                        >
                          {content}
                        </NavLink>
                      )
                    }

                    if(item.notification_type==='messenger_message'){
                      return (
                        <button
                          type="button"
                          className="notification-item messenger-notification-item"
                          key={item.id}
                          onClick={()=>{
                            setNotificationOpen(false)
                            const threadId=item.entity_type==='messenger_thread'?(item.entity_id??''):''
                            if(window.matchMedia('(max-width: 700px)').matches){
                              window.dispatchEvent(new CustomEvent('famioo:open-messenger',{detail:{threadId}}))
                            }else{
                              navigate('/app/messenger')
                            }
                          }}
                        >
                          {content}
                        </button>
                      )
                    }

                    return <div className="notification-item" key={item.id}>{content}</div>
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="header-profile" title={profileName}>
            {profileAvatarUrl
              ? <img className="header-profile-image" src={profileAvatarUrl} alt="" />
              : <span>{profileMark}</span>}
            <strong>{profileName}</strong>
          </div>
        </div>
      </header>

      <main className="app-content"><Outlet /></main>

      <footer className="app-footer">
        <FooterWeather />
        <span>One household space. Everything organized.</span>
      </footer>

      {modules.find((module) => module.code === 'safety')?.enabled && (
        <NavLink className="mobile-safety-shortcut" to="/app/safety" aria-label="Open Family Safety SOS">
          <ShieldAlert size={21}/>
          <span>SOS</span>
        </NavLink>
      )}

      <MobileMessengerQuick />
      <MobileAssistantQuick />

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <NavLink to="/app" end><Home size={19} /><span>Home</span></NavLink>
        <NavLink to="/app/calendar"><CalendarDays size={19} /><span>Calendar</span></NavLink>
        <NavLink to="/app/tasks"><ClipboardList size={19} /><span>Tasks</span></NavLink>
        <NavLink to="/app/settings"><Settings size={19} /><span>Settings</span></NavLink>
        <button type="button" className="mobile-signout-tab" onClick={() => void supabase.auth.signOut()} aria-label="Sign out of Famioo">
          <LogOut size={19} />
          <span>Logout</span>
        </button>
      </nav>
    </div>
  )
}
