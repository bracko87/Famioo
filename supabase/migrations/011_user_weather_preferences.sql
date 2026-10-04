-- Famioo migration 011
-- Personal weather preferences used by the desktop footer.

alter table public.user_profiles
  add column if not exists weather_location_name text,
  add column if not exists weather_latitude double precision,
  add column if not exists weather_longitude double precision,
  add column if not exists weather_temperature_unit text not null default 'celsius';

alter table public.user_profiles
  drop constraint if exists user_profiles_weather_temperature_unit_check;

alter table public.user_profiles
  add constraint user_profiles_weather_temperature_unit_check
  check (weather_temperature_unit in ('celsius','fahrenheit'));

alter table public.user_profiles
  drop constraint if exists user_profiles_weather_coordinates_check;

alter table public.user_profiles
  add constraint user_profiles_weather_coordinates_check
  check (
    (weather_latitude is null and weather_longitude is null)
    or
    (
      weather_latitude between -90 and 90
      and weather_longitude between -180 and 180
    )
  );
