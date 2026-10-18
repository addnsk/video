import type { ParamValues } from '../../core/model';
import type { GpuContext } from './context';
import { UploadTexture } from './textures';

export interface RasterImage {
  readonly source: TexImageSource;
  readonly width: number;
  readonly height: number;
  readonly key: string;
  readonly glyphs: Float32Array;
  readonly count: number;
}

export interface Rasterizer {
  rasterize(params: ParamValues, width: number, height: number, pixelScale: number): RasterImage;
  clear(): void;
}

const RASTER_TEXTURES = 6;

export class RasterTextures {
  private textures = new Map<string, UploadTexture>();

  constructor(private ctx: GpuContext) {}

  get(image: RasterImage): WebGLTexture {
    let upload = this.textures.get(image.key);
    if (upload) this.textures.delete(image.key);
    else upload = new UploadTexture(this.ctx);
    this.textures.set(image.key, upload);
    for (const [key, old] of this.textures) {
      if (this.textures.size <= RASTER_TEXTURES) break;
      old.dispose();
      this.textures.delete(key);
    }
    return upload.upload(image.source, image.width, image.height, image.key);
  }

  clear(): void {
    for (const upload of this.textures.values()) upload.dispose();
    this.textures.clear();
  }
}
