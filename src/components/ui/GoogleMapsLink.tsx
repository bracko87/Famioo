import { MapPin } from 'lucide-react'

type GoogleMapsLinkProps = {
  location: string
  label?: string
  className?: string
}

export function googleMapsSearchUrl(location: string) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location.trim())
}

export function GoogleMapsLink({ location, label, className = '' }: GoogleMapsLinkProps) {
  const clean = location.trim()
  if (!clean) return null

  return (
    <a
      className={'google-maps-link ' + className}
      href={googleMapsSearchUrl(clean)}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      title="Open in Google Maps"
    >
      <MapPin size={11} />
      <span>{label ?? clean}</span>
    </a>
  )
}
