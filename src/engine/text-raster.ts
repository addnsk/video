import type { ParamValues } from '../core/model';
import { MAX_RASTER_GLYPHS } from '../effects/types';
import type { RasterImage, Rasterizer } from './gpu/raster';
import { resources } from './resources';

const CACHE_SIZE = 6;

interface Cached {
  readonly image: RasterImage;
  readonly bitmap: ImageBitmap;
  readonly bytes: number;
}

export interface TextLayoutParams {
  readonly text: string;
  readonly font: string;
  readonly weight: number;
  readonly size: number;
  readonly tracking: number;
  readonly lineSpacing: number;
  readonly align: 'left' | 'center' | 'right';
  readonly outlineWidth: number;
}

export function textLayoutParams(params: ParamValues): TextLayoutParams {
  const align = String(params.align ?? 'center');
  return {
    text: String(params.text ?? ''),
    font: String(params.font ?? 'IBM Plex Sans'),
    weight: Number(params.weight ?? 600),
    size: Math.max(0.001, Number(params.size ?? 0.1)),
    tracking: Number(params.tracking ?? 0),
    lineSpacing: Math.max(0.1, Number(params.lineSpacing ?? 1.2)),
    align: align === 'left' || align === 'right' ? align : 'center',
    outlineWidth: Math.max(0, Number(params.outlineWidth ?? 0)),
  };
}

export class TextRasterizer implements Rasterizer {
  private cache = new Map<string, Cached>();
  private generation = 0;

  rasterize(params: ParamValues, width: number, height: number): RasterImage {
    const layout = textLayoutParams(params);
    const key = `text:${this.generation}:${width}x${height}:${JSON.stringify(layout)}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.image;
    }
    const entry = this.draw(layout, width, height, key);
    resources.acquire('bitmap', entry.bytes);
    this.cache.set(key, entry);
    for (const [k, old] of this.cache) {
      if (this.cache.size <= CACHE_SIZE) break;
      this.cache.delete(k);
      old.bitmap.close();
      resources.release('bitmap', old.bytes);
    }
    return entry.image;
  }

  private draw(layout: TextLayoutParams, width: number, height: number, key: string): Cached {
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, width, height);
    const size = layout.size * height;
    const generic = layout.font.includes('Mono') ? 'monospace' : 'sans-serif';
    g.font = `${layout.weight} ${size}px "${layout.font}", ${generic}`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.lineJoin = 'round';
    g.globalCompositeOperation = 'lighter';
    const spacing = layout.tracking * size;
    const outline = layout.outlineWidth * size;
    const margin = outline + 2;
    const lineHeight = size * layout.lineSpacing;
    const lines = layout.text.split('\n').map((line) => {
      const chars = [...line];
      const offsets = chars.map((_, i) => g.measureText(chars.slice(0, i).join('')).width + spacing * i);
      const advance = chars.length ? g.measureText(line).width + spacing * (chars.length - 1) : 0;
      return { chars, offsets, advance };
    });
    const block = Math.max(0, ...lines.map((l) => l.advance));
    const top = height / 2 - (lineHeight * lines.length) / 2;
    const glyphs = new Float32Array(MAX_RASTER_GLYPHS * 4);
    let count = 0;
    lines.forEach((line, row) => {
      const left = layout.align === 'left' ? (width - block) / 2 : layout.align === 'right' ? (width + block) / 2 - line.advance : (width - line.advance) / 2;
      const y = top + lineHeight * (row + 0.5);
      line.chars.forEach((char, i) => {
        if (!char.trim()) return;
        const x = left + line.offsets[i];
        if (outline > 0) {
          g.strokeStyle = '#0f0';
          g.lineWidth = outline * 2;
          g.strokeText(char, x, y);
        }
        g.fillStyle = '#ff0';
        g.fillText(char, x, y);
        if (count >= MAX_RASTER_GLYPHS) return;
        const w = g.measureText(char).width;
        glyphs.set([(x - margin) / width, 1 - (y + size * 0.75 + margin) / height, (x + w + margin) / width, 1 - (y - size * 0.75 - margin) / height], count * 4);
        count++;
      });
    });
    const bitmap = canvas.transferToImageBitmap();
    return { bitmap, bytes: width * height * 4, image: { source: bitmap, width, height, key, glyphs, count } };
  }

  clear(): void {
    this.generation++;
    for (const entry of this.cache.values()) {
      entry.bitmap.close();
      resources.release('bitmap', entry.bytes);
    }
    this.cache.clear();
  }
}
