export type TemperatureUnit = 'celsius' | 'fahrenheit'

export type WeatherLocation = {
  name: string
  label: string
  latitude: number
  longitude: number
  timezone: string
}

export type CurrentWeather = {
  temperature: number
  weatherCode: number
  isDay: boolean
}

type GeocodingResult = {
  name: string
  country?: string
  admin1?: string
  latitude: number
  longitude: number
  timezone?: string
}

export async function searchWeatherLocations(query: string): Promise<WeatherLocation[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const response = await fetch(
    'https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name='
      + encodeURIComponent(trimmed),
  )

  if (!response.ok) throw new Error('Weather location search failed.')

  const payload = await response.json() as { results?: GeocodingResult[] }

  return (payload.results ?? []).map((item) => {
    const detail = [item.admin1, item.country].filter(Boolean).join(', ')
    return {
      name: item.name,
      label: detail ? item.name + ', ' + detail : item.name,
      latitude: item.latitude,
      longitude: item.longitude,
      timezone: item.timezone ?? 'auto',
    }
  })
}

export async function fetchCurrentWeather(
  latitude: number,
  longitude: number,
  unit: TemperatureUnit,
): Promise<CurrentWeather> {
  const temperatureUnit = unit === 'fahrenheit' ? 'fahrenheit' : 'celsius'
  const response = await fetch(
    'https://api.open-meteo.com/v1/forecast?latitude='
      + encodeURIComponent(latitude)
      + '&longitude='
      + encodeURIComponent(longitude)
      + '&current=temperature_2m,weather_code,is_day'
      + '&temperature_unit=' + temperatureUnit
      + '&timezone=auto',
  )

  if (!response.ok) throw new Error('Current weather could not be loaded.')

  const payload = await response.json() as {
    current?: {
      temperature_2m?: number
      weather_code?: number
      is_day?: number
    }
  }

  if (
    payload.current?.temperature_2m === undefined
    || payload.current.weather_code === undefined
  ) {
    throw new Error('Current weather is unavailable.')
  }

  return {
    temperature: payload.current.temperature_2m,
    weatherCode: payload.current.weather_code,
    isDay: payload.current.is_day !== 0,
  }
}

export function weatherLabel(code: number) {
  if (code === 0) return 'Clear'
  if ([1, 2].includes(code)) return 'Partly cloudy'
  if (code === 3) return 'Cloudy'
  if ([45, 48].includes(code)) return 'Fog'
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow'
  if ([95, 96, 99].includes(code)) return 'Thunderstorm'
  return 'Weather'
}
