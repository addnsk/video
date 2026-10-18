import type { ParamValues } from '../core/model';
import type { RasterImage, Rasterizer } from './gpu/raster';
import { resources } from './resources';

const CACHE_SIZE = 6;

const MAX_ATLAS_HEIGHT = 8192;

interface Cached {
  readonly image: RasterImage;
  readonly bitmap: ImageBitmap;
  readonly atlasBitmap: ImageBitmap;
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
      old.atlasBitmap.close();
      resources.release('bitmap', old.bytes);
    }
    return entry.image;
  }

  private draw(layout: TextLayoutParams, width: number, height: number, key: string): Cached {
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d')!;
    const size = layout.size * height;
    const generic = layout.font.includes('Mono') ? 'monospace' : 'sans-serif';
    const font = `${layout.weight} ${size}px "${layout.font}", ${generic}`;
    const spacing = layout.tracking * size;
    const outline = layout.outlineWidth * size;
    const margin = Math.ceil(outline + 2);
    const lineHeight = size * layout.lineSpacing;
    const prepare = (context: OffscreenCanvasRenderingContext2D) => {
      context.font = font;
      context.textBaseline = 'middle';
      context.textAlign = 'left';
      context.lineJoin = 'round';
      context.globalCompositeOperation = 'lighter';
    };
    const ink = (context: OffscreenCanvasRenderingContext2D, char: string, x: number, y: number) => {
      if (outline > 0) {
        context.strokeStyle = '#0f0';
        context.lineWidth = outline * 2;
        context.strokeText(char, x, y);
      }
      context.fillStyle = '#ff0';
      context.fillText(char, x, y);
    };
    g.fillStyle = '#000';
    g.fillRect(0, 0, width, height);
    prepare(g);
    const lines = layout.text.split('\n').map((line) => {
      const chars = [...line];
      const offsets = chars.map((_, i) => g.measureText(chars.slice(0, i).join('')).width + spacing * i);
      const advance = chars.length ? g.measureText(line).width + spacing * (chars.length - 1) : 0;
      return { chars, offsets, advance };
    });
    const block = Math.max(0, ...lines.map((l) => l.advance));
    const top = height / 2 - (lineHeight * lines.length) / 2;
    const placed: { char: string; x: number; y: number; w: number }[] = [];
    lines.forEach((line, row) => {
      const left = layout.align === 'left' ? (width - block) / 2 : layout.align === 'right' ? (width + block) / 2 - line.advance : (width - line.advance) / 2;
      const y = top + lineHeight * (row + 0.5);
      line.chars.forEach((char, i) => {
        if (!char.trim()) return;
        const x = left + line.offsets[i];
        ink(g, char, x, y);
        placed.push({ char, x, y, w: g.measureText(char).width });
      });
    });
    const cellHeight = Math.ceil(size * 1.5) + margin * 2;
    const cells: { x: number; y: number; w: number }[] = [];
    let cx = 0;
    let cy = 0;
    for (const glyph of placed) {
      const w = Math.ceil(glyph.w) + margin * 2 + 2;
      if (cx + w > width && cx > 0) {
        cx = 0;
        cy += cellHeight;
      }
      cells.push({ x: cx, y: cy, w });
      cx += w;
    }
    const atlasHeight = Math.min(MAX_ATLAS_HEIGHT, Math.max(1, cy + cellHeight));
    const atlas = new OffscreenCanvas(width, atlasHeight);
    const a = atlas.getContext('2d')!;
    a.fillStyle = '#000';
    a.fillRect(0, 0, width, atlasHeight);
    prepare(a);
    const glyphs = new Float32Array(placed.length * 8);
    let count = 0;
    placed.forEach((glyph, i) => {
      const cell = cells[i];
      if (cell.y + cellHeight > atlasHeight) return;
      const frac = glyph.x - Math.floor(glyph.x);
      const fracY = glyph.y - Math.floor(glyph.y);
      const ox = cell.x + margin + 1 + frac;
      const oy = cell.y + cellHeight / 2 + fracY;
      a.save();
      a.beginPath();
      a.rect(cell.x, cell.y, cell.w, cellHeight);
      a.clip();
      ink(a, glyph.char, ox, oy);
      a.restore();
      const x0 = glyph.x - (ox - cell.x);
      const y0 = glyph.y - (oy - cell.y);
      glyphs.set([
        x0 / width, 1 - (y0 + cellHeight) / height, (x0 + cell.w) / width, 1 - y0 / height,
        cell.x / width, 1 - (cell.y + cellHeight) / atlasHeight, (cell.x + cell.w) / width, 1 - cell.y / atlasHeight,
      ], count * 8);
      count++;
    });
    const bitmap = canvas.transferToImageBitmap();
    const atlasBitmap = atlas.transferToImageBitmap();
    const bytes = width * height * 4 + width * atlasHeight * 4;
    return {
      bitmap,
      atlasBitmap,
      bytes,
      image: { source: bitmap, width, height, key, glyphs, count, atlas: { source: atlasBitmap, width, height: atlasHeight, key: `${key}:atlas` } },
    };
  }

  clear(): void {
    this.generation++;
    for (const entry of this.cache.values()) {
      entry.bitmap.close();
      entry.atlasBitmap.close();
      resources.release('bitmap', entry.bytes);
    }
    this.cache.clear();
  }
}
