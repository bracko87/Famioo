import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FREE_MODULE_CODES, MERGED_MODULE_CODES } from '../lib/accountPlan'
import { moduleSlides } from '../lib/moduleMarketing'
import type { ModuleAccess } from '../lib/types'

export function PromoCarousel({ modules }: { modules: ModuleAccess[] }) {
  const [index, setIndex] = useState(0)
  const modulesByCode = useMemo(
    () => new Map(modules.map((module) => [module.code, module])),
    [modules],
  )
  // Promote ONLY unpurchased optional modules. Free, combined legacy and
  // already entitled modules are not upsold on the household homepage.
  const unavailableKey = modules
    .filter(module => !module.entitled && !FREE_MODULE_CODES.has(module.code) && !MERGED_MODULE_CODES.has(module.code))
    .map(module => module.code).sort().join('|')
  const slides = useMemo(() => {
    const availableToPromote = new Set(unavailableKey.split('|'))
    return moduleSlides.filter(slide => availableToPromote.has(slide.code))
  }, [unavailableKey])

  useEffect(() => {
    if (!slides.length) return
    setIndex(0)
    slides.forEach(slide => {
      const image = new Image()
      image.src = slide.image
    })
    const timer = window.setInterval(() => {
      setIndex(current => (current + 1) % slides.length)
    }, 7000)
    return () => window.clearInterval(timer)
  }, [slides])

  if (!slides.length) return null

  return (
    <section className="promo-carousel" aria-label="Explore optional Famioo modules">
      <div className="promo-stage">
        {slides.map((slide, slideIndex) => {
          const module = modulesByCode.get(slide.code)
          const relative = slideIndex === index
            ? 'active'
            : slideIndex === (index - 1 + slides.length) % slides.length
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
                  to={`/app/premium/module/${slide.code}`}
                  tabIndex={relative === 'active' ? 0 : -1}
                >
                  Learn more about this module
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
          {slides.map((item, dotIndex) => (
            <span className={dotIndex === index ? 'active' : ''} key={item.code} />
          ))}
        </div>
      </div>
    </section>
  )
}
