/**
 * Shrink large album uploads before they consume household storage or bandwidth.
 * The processed file is used for both quota reservation and upload, ensuring
 * server-side accounting uses the actual number of stored bytes.
 *
 * WebP retains transparency, is widely supported in current browsers, and
 * stripping the source metadata also avoids uploading embedded GPS EXIF data.
 * Animated GIF, SVG, HEIC and other formats are kept unchanged rather than
 * risking a broken conversion or removing animation.
 */
export async function optimizeMemoryPhoto(file: File): Promise<File> {
  if (!/^image\/(?:jpeg|png|webp|bmp)$/i.test(file.type)) return file
  if (typeof createImageBitmap !== 'function') return file

  let bitmap: ImageBitmap | null = null
  let canvas: HTMLCanvasElement | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(1, 2048 / longest)

    // Tiny originals should not lose quality for an insignificant saving.
    if (scale === 1 && file.size <= 1_000_000) return file

    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas!.toBlob(resolve, 'image/webp', 0.82)
    })
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file

    const name = file.name.replace(/\.[^.]+$/, '') + '.webp'
    return new File([blob], name, { type: blob.type, lastModified: file.lastModified })
  } catch {
    // Native decoder failures must not stop users uploading supported originals.
    return file
  } finally {
    bitmap?.close()
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}
