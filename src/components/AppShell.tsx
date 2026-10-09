import {
  Bell,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  FileText,
  FolderKanban,
  GraduationCap,
  Home,
  House,
  LogOut,
  Menu,
  ChevronLeft,
  ChevronRight,
  Receipt,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Syringe,
  Ticket,
  Utensils,
  X,
} from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import type { ModuleCode } from '../lib/types'
import { Brand } from './Brand'
import { FooterWeather } from './FooterWeather'
import { Select } from './ui/Select'
import { MobileAssistantQuick } from './MobileAssistantQuick'

const iconByModule: Partial<Record<ModuleCode, ComponentType<{ size?: number }>>> = {
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
}

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
  const [notifications, setNotifications] = useState<HeaderNotification[]>([])
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('')
  const enabledPaid = modules.filter((module) => module.enabled && !module.is_core)

  const currentProfile = profiles.find((profile) => profile.linked_user_id === user.id)
  const profileName = currentProfile?.display_name
    ?? (user.user_metadata?.display_name as string | undefined)
    ?? user.email?.split('@')[0]
    ?? 'Profile'
  const profileMark = currentProfile?.avatar_emoji ?? profileName.slice(0, 1).toUpperCase()
  const unreadCount = notifications.filter((item) => item.status === 'sent').length

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

        <nav className="side-nav" aria-label="Main navigation">
          <span className="nav-label">PLAN</span>
          <NavLink to="/app" end onClick={() => setMobileMenu(false)} title="Home"><Home size={18} /><span className="nav-text">Home</span></NavLink>
          <NavLink to="/app/calendar" onClick={() => setMobileMenu(false)} title="Calendar"><CalendarDays size={18} /><span className="nav-text">Calendar</span></NavLink>
          <NavLink to="/app/tasks" onClick={() => setMobileMenu(false)} title="Tasks"><ClipboardList size={18} /><span className="nav-text">Tasks</span></NavLink>
          <NavLink to="/app/checklists" onClick={() => setMobileMenu(false)} title="Checklists"><CheckSquare size={18} /><span className="nav-text">Checklists</span></NavLink>
          <NavLink to="/app/safety" onClick={() => setMobileMenu(false)} title="Family Safety"><ShieldAlert size={18} /><span className="nav-text">Family Safety</span></NavLink>
          <NavLink to="/app/files" onClick={() => setMobileMenu(false)} title="Files"><FileText size={18} /><span className="nav-text">Files</span></NavLink>

          {enabledPaid.length > 0 && <span className="nav-label nav-label-spaced">HOUSEHOLD</span>}
          {enabledPaid.map((module) => {
            const Icon = iconByModule[module.code] ?? Sparkles
            const route = routeByModule[module.code]
            if (!route) return null
            return <NavLink to={route} key={module.code} onClick={() => setMobileMenu(false)} title={module.name}><Icon size={18} /><span className="nav-text">{module.name}</span></NavLink>
          })}
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

                    return item.notification_type==='safety_sos'
                      ? (
                        <NavLink
                          className="notification-item safety-notification-item"
                          to="/app/safety"
                          key={item.id}
                          onClick={()=>setNotificationOpen(false)}
                        >
                          {content}
                        </NavLink>
                      )
                      : <div className="notification-item" key={item.id}>{content}</div>
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
