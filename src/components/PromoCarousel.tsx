import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ModuleAccess, ModuleCode } from '../lib/types'

type PromoSlide = {
  code: ModuleCode
  title: string
  description: string
  image: string
  tone: string
}

const promoSlides: PromoSlide[] = [
  { code: 'calendar', title: 'Keep the whole family in sync.', description: 'Shared events, recurring plans, participants and reminders in one family calendar.', image: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-purple' },
  { code: 'tasks', title: 'Turn everyday jobs into clear responsibilities.', description: 'Create tasks, assign them, reuse templates and keep no-date work visible.', image: 'https://images.unsplash.com/photo-1456324504439-367cee3b3c32?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-orange' },
  { code: 'checklists', title: 'Reusable lists for every family routine.', description: 'Travel, birthdays, school days and recurring routines without rebuilding the same list.', image: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-green' },
  { code: 'shopping', title: 'Shopping lists everyone can update.', description: 'Plan groceries and household shopping together, with shared lists ready for the whole family.', image: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-coral' },
  { code: 'costs', title: 'See household spending without spreadsheets.', description: 'Regular costs, additional expenses, budgets and family spending in one place.', image: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-blue' },
  { code: 'school', title: 'School and Kita, organized around the children.', description: 'Appointments, forms, contacts and weekly school life connected to the family calendar.', image: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-indigo' },
  { code: 'home_care', title: 'Keep the home itself under control.', description: 'Maintenance, warranties, assets and recurring home-care work collected in one module.', image: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-olive' },
  { code: 'life_admin', title: 'Give contracts and renewals a proper home.', description: 'Policies, important dates and household administration without scattered paperwork.', image: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-plum' },
  { code: 'projects', title: 'Plan shared projects and chores together.', description: 'Responsibilities, household projects and family points with clear ownership.', image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-teal' },
  { code: 'meals', title: 'From recipe idea to family meal plan.', description: 'Save recipes, plan meals and send ingredients directly into Shopping.', image: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-rose' },
  { code: 'tickets', title: 'Keep every family ticket ready when you need it.', description: 'Store travel and event tickets, scan QR codes and put the appointment directly into Calendar.', image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-purple' },
  { code: 'files', title: 'Important family documents, where you expect them.', description: 'Keep useful household files and attachments connected to the rest of Famioo.', image: 'https://images.unsplash.com/photo-1568667256549-094345857637?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-slate' },
  { code: 'assistant', title: 'A household assistant that sees the bigger picture.', description: 'Future Famioo intelligence can surface what needs attention across your family modules.', image: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1200&q=80', tone: 'promo-tone-violet' },
]

const routeByModule: Record<ModuleCode, string> = {
  calendar: '/app/calendar',
  calendar_connections: '/app/calendar/connections',
  tasks: '/app/tasks',
  checklists: '/app/checklists',
  safety: '/app/safety',
  location: '/app/location',
  messenger: '/app/messenger',
  contacts: '/app/contacts',
  memo: '/app/memo',
  rewards: '/app/rewards',
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
}

export function PromoCarousel({ modules }: { modules: ModuleAccess[] }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    promoSlides.forEach((slide) => {
      const image = new Image()
      image.src = slide.image
    })

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % promoSlides.length)
    }, 7000)

    return () => window.clearInterval(timer)
  }, [])

  const modulesByCode = useMemo(
    () => new Map(modules.map((module) => [module.code, module])),
    [modules],
  )

  return (
    <section className="promo-carousel" aria-label="Famioo module highlights">
      <div className="promo-stage">
        {promoSlides.map((slide, slideIndex) => {
          const module = modulesByCode.get(slide.code)
          const relative = slideIndex === index
            ? 'active'
            : slideIndex === (index - 1 + promoSlides.length) % promoSlides.length
              ? 'previous'
              : 'inactive'

          return (
            <article
              className={`promo-slide promo-layer ${slide.tone} ${relative}`}
              aria-hidden={relative !== 'active'}
              key={slide.code}
            >
              <div className="famioo-promo-copy">
                <span className="eyebrow light">{module?.name?.toUpperCase() ?? slide.code.toUpperCase()}</span>
                <h2>{slide.title}</h2>
                <p>{slide.description}</p>
                <Link
                  className="famioo-promo-action"
                  to={routeByModule[slide.code]}
                  tabIndex={relative === 'active' ? 0 : -1}
                >
                  {module?.is_core ? 'Open module' : 'Discover module'}
                  <span>→</span>
                </Link>
              </div>

              <div
                className="famioo-promo-image"
                aria-hidden="true"
                style={{ backgroundImage: `url("${slide.image}")` }}
              />
            </article>
          )
        })}

        <div className="famioo-promo-progress" aria-hidden="true">
          {promoSlides.map((item, dotIndex) => (
            <span className={dotIndex === index ? 'active' : ''} key={item.code} />
          ))}
        </div>
      </div>
    </section>
  )
}
