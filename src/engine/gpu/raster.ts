import type { ParamValues } from '../../core/model';
import type { GpuContext } from './context';
import { UploadTexture } from './textures';

export interface RasterPlane {
  readonly source: TexImageSource;
  readonly width: number;
  readonly height: number;
  readonly key: string;
}

export interface RasterImage extends RasterPlane {
  readonly glyphs: Float32Array;
  readonly count: number;
  readonly atlas?: RasterPlane;
}

export interface Rasterizer {
  rasterize(params: ParamValues, width: number, height: number, pixelScale: number): RasterImage;
  clear(): void;
}

const RASTER_TEXTURES = 12;
export const GLYPH_DATA_WIDTH = 512;

export class RasterTextures {
  private textures = new Map<string, UploadTexture>();

  constructor(private ctx: GpuContext) {}

  get(image: RasterPlane): WebGLTexture {
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

  private data = new Map<string, WebGLTexture>();

  glyphData(image: RasterImage, unit: number): WebGLTexture {
    const gl = this.ctx.gl;
    let texture = this.data.get(image.key);
    if (texture) {
      this.data.delete(image.key);
      this.data.set(image.key, texture);
      return texture;
    }
    const texels = Math.max(1, image.count * 2);
    const width = Math.min(GLYPH_DATA_WIDTH, texels);
    const height = Math.ceil(texels / GLYPH_DATA_WIDTH);
    const values = new Float32Array(width * height * 4);
    values.set(image.glyphs.subarray(0, image.count * 8));
    gl.activeTexture(gl.TEXTURE0 + unit);
    texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, values);
    this.data.set(image.key, texture);
    for (const [key, old] of this.data) {
      if (this.data.size <= RASTER_TEXTURES) break;
      gl.deleteTexture(old);
      this.data.delete(key);
    }
    return texture;
  }

  clear(): void {
    for (const upload of this.textures.values()) upload.dispose();
    this.textures.clear();
    for (const texture of this.data.values()) this.ctx.gl.deleteTexture(texture);
    this.data.clear();
  }
}
