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
  Receipt,
  Settings,
  ShoppingBag,
  Sparkles,
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
}

type HeaderNotification = {
  id: string
  title: string
  body: string
  status: 'pending' | 'sent' | 'read' | 'failed' | 'cancelled'
  created_at: string
}

export function AppShell() {
  const { household, households, modules, profiles, user, switchHousehold } = useHousehold()
  const [mobileMenu, setMobileMenu] = useState(false)
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

  async function loadNotifications() {
    const result = await supabase
      .from('notifications')
      .select('id,title,body,status,created_at')
      .eq('household_id', household.id)
      .eq('recipient_user_id', user.id)
      .in('status', ['sent', 'read'])
      .order('created_at', { ascending: false })
      .limit(6)

    if (!result.error) setNotifications((result.data ?? []) as HeaderNotification[])
  }

  useEffect(() => {
    void loadNotifications()
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
    <div className="app-layout">
      <aside className={mobileMenu ? 'app-sidebar open' : 'app-sidebar'}>
        <div className="sidebar-top">
          <Brand />
          <button className="icon-button mobile-sidebar-close" onClick={() => setMobileMenu(false)} aria-label="Close menu">
            <X size={19} />
          </button>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          <span className="nav-label">PLAN</span>
          <NavLink to="/app" end onClick={() => setMobileMenu(false)}><Home size={18} />Home</NavLink>
          <NavLink to="/app/calendar" onClick={() => setMobileMenu(false)}><CalendarDays size={18} />Calendar</NavLink>
          <NavLink to="/app/tasks" onClick={() => setMobileMenu(false)}><ClipboardList size={18} />Tasks</NavLink>
          <NavLink to="/app/checklists" onClick={() => setMobileMenu(false)}><CheckSquare size={18} />Checklists</NavLink>

          {enabledPaid.length > 0 && <span className="nav-label nav-label-spaced">HOUSEHOLD</span>}
          {enabledPaid.map((module) => {
            const Icon = iconByModule[module.code] ?? Sparkles
            const route = routeByModule[module.code]
            if (!route) return null
            return <NavLink to={route} key={module.code} onClick={() => setMobileMenu(false)}><Icon size={18} />{module.name}</NavLink>
          })}
        </nav>

        <nav className="side-nav side-nav-bottom">
          <NavLink to="/app/settings" onClick={() => setMobileMenu(false)}><Settings size={18} />Settings</NavLink>
          <button onClick={() => void supabase.auth.signOut()}><LogOut size={18} />Sign out</button>
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
            <select value={household.id} onChange={(event) => void switchHousehold(event.target.value)}>
              {households.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
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
                  ) : notifications.map((item) => (
                    <div className="notification-item" key={item.id}>
                      <span className={item.status === 'read' ? 'read' : ''} />
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.body}</p>
                        <small>{new Date(item.created_at).toLocaleString()}</small>
                      </div>
                    </div>
                  ))}
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

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <NavLink to="/app" end><Home size={19} /><span>Home</span></NavLink>
        <NavLink to="/app/calendar"><CalendarDays size={19} /><span>Calendar</span></NavLink>
        <NavLink to="/app/tasks"><ClipboardList size={19} /><span>Tasks</span></NavLink>
        <NavLink to="/app/checklists"><CheckSquare size={19} /><span>Lists</span></NavLink>
      </nav>
    </div>
  )
}
