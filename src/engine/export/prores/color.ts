import type { Planes422 } from './encoder';

const KR = 0.2126;
const KB = 0.0722;
const KG = 1 - KR - KB;

export function rgbaToPlanes422(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, target?: Planes422): Planes422 {
  const chromaWidth = width >> 1;
  const planes =
    target && target.width === width && target.height === height
      ? target
      : { width, height, y: new Uint16Array(width * height), cb: new Uint16Array(chromaWidth * height), cr: new Uint16Array(chromaWidth * height) };
  for (let row = 0; row < height; row++) {
    for (let x = 0; x < chromaWidth; x++) {
      let pb = 0;
      let pr = 0;
      for (let k = 0; k < 2; k++) {
        const i = (row * width + x * 2 + k) * 4;
        const r = rgba[i] / 255;
        const g = rgba[i + 1] / 255;
        const b = rgba[i + 2] / 255;
        const luma = KR * r + KG * g + KB * b;
        planes.y[row * width + x * 2 + k] = Math.round(64 + 876 * luma);
        pb += (b - luma) / (2 * (1 - KB));
        pr += (r - luma) / (2 * (1 - KR));
      }
      planes.cb[row * chromaWidth + x] = Math.round(512 + 896 * (pb / 2));
      planes.cr[row * chromaWidth + x] = Math.round(512 + 896 * (pr / 2));
    }
  }
  return planes;
}
