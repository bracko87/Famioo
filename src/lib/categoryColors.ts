export const categoryColors: Record<string, string> = {
  purple: '#8b5bc1',
  blue: '#5f7fc7',
  indigo: '#6b68c9',
  green: '#4f9b77',
  pink: '#ca6698',
  orange: '#dc9140',
  teal: '#4e9c92',
  slate: '#7d8395',
  red: '#c96666',
  yellow: '#c8a044',
}

export const categoryColorOptions = [
  { key: 'purple', label: 'Purple' },
  { key: 'blue', label: 'Blue' },
  { key: 'indigo', label: 'Indigo' },
  { key: 'green', label: 'Green' },
  { key: 'pink', label: 'Pink' },
  { key: 'orange', label: 'Orange' },
  { key: 'teal', label: 'Teal' },
  { key: 'slate', label: 'Slate' },
  { key: 'red', label: 'Red' },
  { key: 'yellow', label: 'Yellow' },
] as const

export function categoryColor(key: string) {
  return categoryColors[key] ?? categoryColors.slate
}
