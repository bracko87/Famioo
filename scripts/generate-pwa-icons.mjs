import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve('public/famioo-app-icon.svg')
await mkdir(resolve('public'), { recursive: true })

const targets = [
  ['famioo-icon-192.png', 192],
  ['famioo-icon-512.png', 512],
  ['famioo-apple-touch-icon.png', 180],
]

for (const [name,size] of targets) {
  await sharp(source)
    .resize(size,size)
    .png()
    .toFile(resolve('public',name))
}

console.log('Generated Famioo PWA icons.')
