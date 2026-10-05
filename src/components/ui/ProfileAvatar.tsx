import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const signedUrlCache = new Map<string, string>()

type Props = {
  avatarPath: string | null
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function ProfileAvatar({ avatarPath, name, size = 'md', className = '' }: Props) {
  const [url, setUrl] = useState(() => avatarPath ? signedUrlCache.get(avatarPath) ?? '' : '')

  useEffect(() => {
    let active = true

    if (!avatarPath) {
      setUrl('')
      return
    }

    const cached = signedUrlCache.get(avatarPath)
    if (cached) {
      setUrl(cached)
      return
    }

    void supabase.storage
      .from('profile-avatars')
      .createSignedUrl(avatarPath, 3600)
      .then(({ data }) => {
        if (!active) return
        const signed = data?.signedUrl ?? ''
        if (signed) signedUrlCache.set(avatarPath, signed)
        setUrl(signed)
      })

    return () => {
      active = false
    }
  }, [avatarPath])

  const initial = name.trim().slice(0, 1).toUpperCase() || '?'

  return (
    <span className={'profile-avatar profile-avatar-' + size + ' ' + className} aria-hidden="true">
      {url ? <img src={url} alt="" /> : <span>{initial}</span>}
    </span>
  )
}
