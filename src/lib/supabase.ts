import { createClient } from '@supabase/supabase-js'

const defaultUrl = 'https://pqnotyfcypxsspyhtcqn.supabase.co'
const defaultPublishableKey = 'sb_publishable_xJJyzoEgJFQJeZT3nMQUiA_dcCchPkC'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || defaultUrl
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || defaultPublishableKey

export const supabase = createClient(
  url,
  key,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
