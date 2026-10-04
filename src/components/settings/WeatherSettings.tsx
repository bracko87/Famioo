import { MapPin, Search } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { supabase } from '../../lib/supabase'
import {
  searchWeatherLocations,
  type TemperatureUnit,
  type WeatherLocation,
} from '../../lib/weather'
import { Select } from '../ui/Select'

export function WeatherSettings() {
  const { household, user } = useHousehold()
  const [weatherQuery, setWeatherQuery] = useState('')
  const [weatherResults, setWeatherResults] = useState<WeatherLocation[]>([])
  const [selectedWeather, setSelectedWeather] = useState<WeatherLocation | null>(null)
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>('celsius')
  const [weatherBusy, setWeatherBusy] = useState(false)
  const [weatherMessage, setWeatherMessage] = useState('')

  useEffect(() => {
    void supabase
      .from('user_profiles')
      .select('weather_location_name,weather_latitude,weather_longitude,weather_temperature_unit')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!data) return

        setTemperatureUnit((data.weather_temperature_unit ?? 'celsius') as TemperatureUnit)

        if (
          data.weather_location_name
          && data.weather_latitude !== null
          && data.weather_longitude !== null
        ) {
          const location: WeatherLocation = {
            name: data.weather_location_name,
            label: data.weather_location_name,
            latitude: data.weather_latitude,
            longitude: data.weather_longitude,
            timezone: household.timezone,
          }
          setSelectedWeather(location)
          setWeatherQuery(data.weather_location_name)
        }
      })
  }, [user.id, household.timezone])

  async function searchWeather(event: FormEvent) {
    event.preventDefault()
    setWeatherBusy(true)
    setWeatherMessage('')

    try {
      const results = await searchWeatherLocations(weatherQuery)
      setWeatherResults(results)
      if (!results.length) setWeatherMessage('No matching city or town was found.')
    } catch (error) {
      setWeatherMessage(error instanceof Error ? error.message : 'Weather location search failed.')
    } finally {
      setWeatherBusy(false)
    }
  }

  async function saveWeather() {
    if (!selectedWeather) {
      setWeatherMessage('Choose a city or town from the search results first.')
      return
    }

    setWeatherBusy(true)
    setWeatherMessage('')

    const result = await supabase
      .from('user_profiles')
      .update({
        weather_location_name: selectedWeather.label,
        weather_latitude: selectedWeather.latitude,
        weather_longitude: selectedWeather.longitude,
        weather_temperature_unit: temperatureUnit,
      })
      .eq('id', user.id)

    setWeatherBusy(false)

    if (result.error) {
      setWeatherMessage(result.error.message)
      return
    }

    setWeatherMessage('Weather preference saved.')
    setWeatherQuery(selectedWeather.label)
    setWeatherResults([])
    window.dispatchEvent(new Event('famioo-weather-preferences-updated'))
  }

  return (
    <section className="settings-card settings-weather-card">
      <div className="settings-card-heading">
        <div>
          <span className="eyebrow">WEATHER</span>
          <h2>Footer weather</h2>
          <p>Choose the city or town you want to see in the desktop footer.</p>
        </div>
        <MapPin size={22} />
      </div>

      <form className="weather-search-form" onSubmit={searchWeather}>
        <label>
          City or town
          <span className="weather-search-input">
            <input
              value={weatherQuery}
              onChange={(event) => {
                setWeatherQuery(event.target.value)
                setSelectedWeather(null)
              }}
              placeholder="Norderstedt, Hamburg, Belgrade…"
            />
            <button
              className="secondary-button compact"
              disabled={weatherBusy || weatherQuery.trim().length < 2}
            >
              <Search size={15} />
              Search
            </button>
          </span>
        </label>

        <label>
          Temperature
          <Select
            value={temperatureUnit}
            onChange={(value) => setTemperatureUnit(value as TemperatureUnit)}
            options={[
              { value: 'celsius', label: 'Celsius (°C)' },
              { value: 'fahrenheit', label: 'Fahrenheit (°F)' },
            ]}
            ariaLabel="Temperature unit"
          />
        </label>
      </form>

      {weatherResults.length > 0 && (
        <div className="weather-location-results">
          {weatherResults.map((location) => (
            <button
              type="button"
              className={
                selectedWeather?.latitude === location.latitude
                && selectedWeather?.longitude === location.longitude
                  ? 'selected'
                  : ''
              }
              key={location.label + location.latitude + location.longitude}
              onClick={() => {
                setSelectedWeather(location)
                setWeatherQuery(location.label)
                setWeatherMessage('')
              }}
            >
              <MapPin size={15} />
              <span>
                <strong>{location.label}</strong>
                <small>{location.latitude.toFixed(2)}, {location.longitude.toFixed(2)}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="weather-settings-actions">
        <span>{selectedWeather ? 'Selected: ' + selectedWeather.label : 'Search and select a location.'}</span>
        <button
          type="button"
          className="primary-button compact"
          disabled={weatherBusy || !selectedWeather}
          onClick={() => void saveWeather()}
        >
          {weatherBusy ? 'Saving…' : 'Save weather'}
        </button>
      </div>

      {weatherMessage && <div className="form-message">{weatherMessage}</div>}
    </section>
  )
}
