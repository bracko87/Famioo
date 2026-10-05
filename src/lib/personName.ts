export function firstName(displayName: string) {
  const trimmed = displayName.trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/)[0]
}
