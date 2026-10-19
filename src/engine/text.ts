import type { TextStyle } from '../core/model';
import type { FrameImage } from './media/frame';
import { resources } from './resources';

const CACHE_SIZE = 12;
const LINE_HEIGHT = 1.2;
const PADDING = 0.4;

interface CachedText {
  frame: FrameImage;
  bitmap: ImageBitmap;
  bytes: number;
}

const styleKey = (s: TextStyle, w: number, h: number) =>
  `${w}x${h}|${s.font}|${s.weight}|${s.size}|${s.color}|${s.align}|${s.background ?? ''}|${s.outline ?? ''}|${s.outlineWidth ?? 0}|${s.maxWidth ?? ''}|${s.bottom ?? ''}|${s.content}`;

function wrap(g: OffscreenCanvasRenderingContext2D, text: string, limit: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/(\s+)/).filter((w) => w !== '');
    let line = '';
    for (const word of words) {
      const next = line + word;
      if (line.trim() && g.measureText(next.trimEnd()).width > limit) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
      while (g.measureText(line).width > limit && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && g.measureText(line.slice(0, cut)).width > limit) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export class TextRenderer {
  private cache = new Map<string, CachedText>();

  render(style: TextStyle, width: number, height: number): FrameImage {
    const key = styleKey(style, width, height);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.frame;
    }
    const bitmap = this.draw(style, width, height);
    const bytes = width * height * 4;
    const entry = { bitmap, bytes, frame: { source: bitmap, width, height, timestamp: 0, key: `text:${key}` } };
    resources.acquire('bitmap', bytes);
    this.cache.set(key, entry);
    while (this.cache.size > CACHE_SIZE) {
      const [oldKey, old] = this.cache.entries().next().value!;
      this.cache.delete(oldKey);
      old.bitmap.close();
      resources.release('bitmap', old.bytes);
    }
    return entry.frame;
  }

  private draw(style: TextStyle, width: number, height: number): ImageBitmap {
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d')!;
    const size = Math.max(1, style.size * height);
    const generic = style.font.includes('Mono') ? 'monospace' : 'sans-serif';
    g.font = `${style.weight} ${size}px "${style.font}", ${generic}`;
    g.textBaseline = 'middle';
    g.textAlign = style.align;
    const lines = style.maxWidth ? wrap(g, style.content, style.maxWidth * width) : style.content.split('\n');
    const lineHeight = size * LINE_HEIGHT;
    const blockWidth = Math.max(...lines.map((l) => g.measureText(l).width));
    const blockHeight = lineHeight * lines.length;
    const anchorX = style.align === 'left' ? width / 2 - blockWidth / 2 : style.align === 'right' ? width / 2 + blockWidth / 2 : width / 2;
    const top = style.bottom !== undefined ? height * (1 - style.bottom) - blockHeight : height / 2 - blockHeight / 2;
    if (style.background) {
      const pad = size * PADDING;
      g.fillStyle = style.background;
      g.beginPath();
      g.roundRect(width / 2 - blockWidth / 2 - pad, top - pad / 2, blockWidth + pad * 2, blockHeight + pad, pad / 2);
      g.fill();
    }
    if (style.outline && style.outlineWidth) {
      g.strokeStyle = style.outline;
      g.lineWidth = size * style.outlineWidth * 2;
      g.lineJoin = 'round';
      g.miterLimit = 2;
      lines.forEach((line, i) => g.strokeText(line, anchorX, top + lineHeight * (i + 0.5)));
    }
    g.fillStyle = style.color;
    lines.forEach((line, i) => g.fillText(line, anchorX, top + lineHeight * (i + 0.5)));
    return canvas.transferToImageBitmap();
  }

  clear(): void {
    for (const entry of this.cache.values()) {
      entry.bitmap.close();
      resources.release('bitmap', entry.bytes);
    }
    this.cache.clear();
  }
}
