import type { GpuContext } from './context';
import { resources } from '../resources';

export interface RenderTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
}

function configure(gl: WebGL2RenderingContext, target: number) {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
}

const bytesPerPixel = (float: boolean) => (float ? 8 : 4);

export class TargetPool {
  private free = new Map<string, RenderTarget[]>();
  private generation: number;

  constructor(private ctx: GpuContext) {
    this.generation = ctx.generation;
  }

  acquire(width: number, height: number): RenderTarget {
    this.checkGeneration();
    const key = `${width}x${height}`;
    const reuse = this.free.get(key)?.pop();
    if (reuse) return reuse;
    const gl = this.ctx.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    configure(gl, gl.TEXTURE_2D);
    gl.texStorage2D(gl.TEXTURE_2D, 1, this.ctx.floatTargets ? gl.RGBA16F : gl.RGBA8, width, height);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    resources.acquire('framebuffer', width * height * bytesPerPixel(this.ctx.floatTargets));
    return { texture, framebuffer, width, height };
  }

  release(target: RenderTarget): void {
    const key = `${target.width}x${target.height}`;
    let list = this.free.get(key);
    if (!list) this.free.set(key, (list = []));
    list.push(target);
  }

  trim(): void {
    const gl = this.ctx.gl;
    for (const list of this.free.values())
      for (const t of list) {
        gl.deleteTexture(t.texture);
        gl.deleteFramebuffer(t.framebuffer);
        resources.release('framebuffer', t.width * t.height * bytesPerPixel(this.ctx.floatTargets));
      }
    this.free.clear();
  }

  private checkGeneration() {
    if (this.generation === this.ctx.generation) return;
    this.free.clear();
    this.generation = this.ctx.generation;
  }
}

export class UploadTexture {
  private texture: WebGLTexture | null = null;
  private width = 0;
  private height = 0;
  private half = true;
  private generation = -1;
  private uploadedKey = '';

  constructor(private ctx: GpuContext) {}

  upload(source: TexImageSource, width: number, height: number, key: string): WebGLTexture {
    const gl = this.ctx.gl;
    if (this.generation !== this.ctx.generation || this.width !== width || this.height !== height) this.allocate(width, height);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (key && key === this.uploadedKey) return this.texture!;
    if (this.half) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.HALF_FLOAT, source);
      if (gl.getError() !== gl.NO_ERROR) {
        this.half = false;
        this.allocate(width, height);
      }
    }
    if (!this.half) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.uploadedKey = key;
    return this.texture!;
  }

  private allocate(width: number, height: number) {
    const gl = this.ctx.gl;
    this.dispose();
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    configure(gl, gl.TEXTURE_2D);
    gl.texStorage2D(gl.TEXTURE_2D, 1, this.half ? gl.RGBA16F : gl.RGBA8, width, height);
    this.width = width;
    this.height = height;
    this.generation = this.ctx.generation;
    this.uploadedKey = '';
    resources.acquire('texture', width * height * bytesPerPixel(this.half));
  }

  dispose(): void {
    if (!this.texture) return;
    if (this.generation === this.ctx.generation) this.ctx.gl.deleteTexture(this.texture);
    resources.release('texture', this.width * this.height * bytesPerPixel(this.half));
    this.texture = null;
  }
}

export class CurveTextures {
  private textures = new Map<string, { texture: WebGLTexture; generation: number; used: number }>();
  private clock = 0;

  constructor(private ctx: GpuContext) {}

  get(key: string, samples: () => Float32Array): WebGLTexture {
    const gl = this.ctx.gl;
    const cached = this.textures.get(key);
    if (cached && cached.generation === this.ctx.generation) {
      cached.used = ++this.clock;
      return cached.texture;
    }
    const data = samples();
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    configure(gl, gl.TEXTURE_2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, data.length, 1, 0, gl.RED, gl.FLOAT, data);
    this.textures.set(key, { texture, generation: this.ctx.generation, used: ++this.clock });
    this.evict();
    return texture;
  }

  private evict() {
    if (this.textures.size <= 64) return;
    const oldest = [...this.textures.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.textures.size - 64);
    for (const [key, entry] of oldest) {
      if (entry.generation === this.ctx.generation) this.ctx.gl.deleteTexture(entry.texture);
      this.textures.delete(key);
    }
  }
}

export class LutTextures {
  private textures = new Map<string, { texture: WebGLTexture; generation: number; data: Float32Array }>();

  constructor(private ctx: GpuContext) {}

  get(id: string, lut: { size: number; data: Float32Array } | undefined): WebGLTexture | null {
    if (!lut) return null;
    const gl = this.ctx.gl;
    const cached = this.textures.get(id);
    if (cached && cached.generation === this.ctx.generation && cached.data === lut.data) return cached.texture;
    if (cached && cached.generation === this.ctx.generation) gl.deleteTexture(cached.texture);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, texture);
    configure(gl, gl.TEXTURE_3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
    this.textures.set(id, { texture, generation: this.ctx.generation, data: lut.data });
    return texture;
  }

  delete(id: string): void {
    const cached = this.textures.get(id);
    if (cached && cached.generation === this.ctx.generation) this.ctx.gl.deleteTexture(cached.texture);
    this.textures.delete(id);
  }
}
