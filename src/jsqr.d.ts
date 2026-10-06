declare module 'jsqr' {
  export type Point = {
    x: number
    y: number
  }

  export type QRCodeLocation = {
    topRightCorner: Point
    topLeftCorner: Point
    bottomRightCorner: Point
    bottomLeftCorner: Point
    topRightFinderPattern: Point
    topLeftFinderPattern: Point
    bottomLeftFinderPattern: Point
    bottomRightAlignmentPattern?: Point
  }

  export type QRCode = {
    binaryData: number[]
    data: string
    chunks: unknown[]
    version: number
    location: QRCodeLocation
  }

  export type Options = {
    inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst'
  }

  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: Options,
  ): QRCode | null
}
