import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  MapPin,
  Sun,
} from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import {
  fetchCurrentWeather,
  weatherLabel,
  type CurrentWeather,
  type TemperatureUnit,
} from '../lib/weather'

type Preference = {
  weather_location_name: string | null
  weather_latitude: number | null
  weather_longitude: number | null
  weather_temperature_unit: TemperatureUnit
}

function WeatherIcon({ code, isDay }: { code: number; isDay: boolean }) {
  let Icon: ComponentType<{ size?: number }> = CloudSun

  if (code === 0) Icon = isDay ? Sun : CloudSun
  else if ([1, 2].includes(code)) Icon = CloudSun
  else if (code === 3) Icon = Cloud
  else if ([45, 48].includes(code)) Icon = CloudFog
  else if ([51, 53, 55, 56, 57].includes(code)) Icon = CloudDrizzle
  else if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) Icon = CloudRain
  else if ([71, 73, 75, 77, 85, 86].includes(code)) Icon = CloudSnow
  else if ([95, 96, 99].includes(code)) Icon = CloudLightning

  return <Icon size={19} />
}

export function FooterWeather() {
  const { user } = useHousehold()
  const [preference, setPreference] = useState<Preference | null>(null)
  const [weather, setWeather] = useState<CurrentWeather | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)

    const result = await supabase
      .from('user_profiles')
      .select('weather_location_name,weather_latitude,weather_longitude,weather_temperature_unit')
      .eq('id', user.id)
      .single()

    if (result.error) {
      setPreference(null)
      setWeather(null)
      setLoading(false)
      return
    }

    const next = result.data as Preference
    setPreference(next)

    if (
      next.weather_latitude === null
      || next.weather_longitude === null
      || !next.weather_location_name
    ) {
      setWeather(null)
      setLoading(false)
      return
    }

    try {
      const current = await fetchCurrentWeather(
        next.weather_latitude,
        next.weather_longitude,
        next.weather_temperature_unit,
      )
      setWeather(current)
    } catch {
      setWeather(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()

    const refresh = () => void load()
    window.addEventListener('famioo-weather-preferences-updated', refresh)

    return () => window.removeEventListener('famioo-weather-preferences-updated', refresh)
  }, [user.id])

  if (loading) {
    return <div className="footer-weather footer-weather-muted">Loading weather…</div>
  }

  if (!preference?.weather_location_name || !weather) {
    return (
      <Link className="footer-weather footer-weather-muted" to="/app/settings">
        <MapPin size={17} />
        <span>
          <strong>Weather</strong>
          <small>Choose location in Settings</small>
        </span>
      </Link>
    )
  }

  const unit = preference.weather_temperature_unit === 'fahrenheit' ? '°F' : '°C'

  return (
    <Link className="footer-weather" to="/app/settings">
      <WeatherIcon code={weather.weatherCode} isDay={weather.isDay} />
      <span>
        <strong>{Math.round(weather.temperature)}{unit} · {preference.weather_location_name}</strong>
        <small>{weatherLabel(weather.weatherCode)}</small>
      </span>
    </Link>
  )
}
