import type { EffectInstance, ParamValue, ParamValues } from '../../core/model';
import type { CompositionFrame, LayerFrame, TrackFrame } from '../../core/timeline';
import type { EffectRegistry } from '../../effects/registry';
import type { FilterDef, ParamSpec, TransitionDef } from '../../effects/types';
import type { FrameImage } from '../media/frame';
import type { GpuContext } from './context';
import { COPY, FIT, filterSource, transitionSource } from './shaders';
import { LutTextures, TargetPool, UploadTexture, type RenderTarget } from './textures';

export interface LutProvider {
  lut(id: string): { size: number; data: Float32Array } | undefined;
}

export interface RenderOptions {
  readonly bypassFilters?: boolean;
}

const sources = new WeakMap<FilterDef | TransitionDef, string>();
const sourceOf = (def: FilterDef | TransitionDef) => {
  let s = sources.get(def);
  if (!s) sources.set(def, (s = def.kind === 'filter' ? filterSource(def) : transitionSource(def)));
  return s;
};

export class Compositor {
  private targets: TargetPool;
  private uploads = new Map<string, UploadTexture>();
  private luts: LutTextures;
  private width = 0;
  private height = 0;
  onError: (message: string) => void = () => {};

  constructor(
    private ctx: GpuContext,
    private registry: EffectRegistry,
    private lutProvider: LutProvider,
  ) {
    this.targets = new TargetPool(ctx);
    this.luts = new LutTextures(ctx);
  }

  render(frame: CompositionFrame, images: ReadonlyMap<string, FrameImage>, options: RenderOptions = {}): void {
    const gl = this.ctx.gl;
    if (this.ctx.lost) return;
    const surface = this.ctx.surface;
    this.width = surface.width;
    this.height = surface.height;
    let accumulator: RenderTarget | null = null;
    for (const layer of frame.layers) {
      const result = this.renderTrack(layer, images, options);
      if (!result) continue;
      if (!accumulator) {
        accumulator = result;
        continue;
      }
      this.blend(result, accumulator);
      this.targets.release(result);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (accumulator) {
      this.blend(accumulator, null);
      this.targets.release(accumulator);
    }
    this.collect(frame);
  }

  private renderTrack(layer: TrackFrame, images: ReadonlyMap<string, FrameImage>, options: RenderOptions): RenderTarget | null {
    const base = this.renderLayer(layer.base, images, options);
    if (!layer.transition) return base;
    const incoming = this.renderLayer(layer.transition.incoming, images, options);
    if (!base || !incoming) return base ?? incoming;
    const def = this.registry.transition(layer.transition.transition.type);
    if (!def) {
      this.targets.release(incoming);
      return base;
    }
    let program: WebGLProgram;
    try {
      program = this.ctx.program(sourceOf(def));
    } catch (e) {
      this.onError(`Transition "${def.name}": ${(e as Error).message}`);
      this.targets.release(incoming);
      return base;
    }
    const gl = this.ctx.gl;
    const out = this.targets.acquire(this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program);
    this.bindTexture(program, 'u_from', 0, base.texture);
    this.bindTexture(program, 'u_to', 1, incoming.texture);
    gl.uniform1f(this.ctx.uniform(program, 'progress'), Math.min(1, Math.max(0, layer.transition.progress)));
    gl.uniform1f(this.ctx.uniform(program, 'ratio'), this.width / this.height);
    this.applyParams(program, def.params, layer.transition.transition.params, 2);
    this.ctx.drawQuad();
    this.targets.release(base);
    this.targets.release(incoming);
    return out;
  }

  private renderLayer(layer: LayerFrame, images: ReadonlyMap<string, FrameImage>, options: RenderOptions): RenderTarget | null {
    const { item } = layer.placement;
    const image = images.get(item.id);
    if (!image) return null;
    let upload = this.uploads.get(item.id);
    if (!upload) this.uploads.set(item.id, (upload = new UploadTexture(this.ctx)));
    const texture = upload.upload(image.source, image.width, image.height, image.key);
    let current = this.fit(texture, image.width, image.height);
    if (options.bypassFilters) return current;
    for (const effect of item.effects) {
      if (!effect.enabled) continue;
      const next = this.applyFilter(effect, current);
      if (next !== current) {
        this.targets.release(current);
        current = next;
      }
    }
    return current;
  }

  private fit(texture: WebGLTexture, width: number, height: number): RenderTarget {
    const gl = this.ctx.gl;
    const out = this.targets.acquire(this.width, this.height);
    const scale = Math.min(this.width / width, this.height / height);
    const w = (width * scale) / this.width;
    const h = (height * scale) / this.height;
    const program = this.ctx.program(FIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program);
    this.bindTexture(program, 'u_image', 0, texture);
    gl.uniform4f(this.ctx.uniform(program, 'u_rect'), (1 - w) / 2, (1 - h) / 2, w, h);
    this.ctx.drawQuad();
    return out;
  }

  private applyFilter(effect: EffectInstance, input: RenderTarget): RenderTarget {
    const def = this.registry.filter(effect.type);
    if (!def) return input;
    if (def.params.some((p) => p.type === 'resource' && !effect.params[p.name])) return input;
    let program: WebGLProgram;
    try {
      program = this.ctx.program(sourceOf(def));
    } catch (e) {
      this.onError(`Effect "${def.name}": ${(e as Error).message}`);
      return input;
    }
    const gl = this.ctx.gl;
    const out = this.targets.acquire(this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program);
    this.bindTexture(program, 'u_source', 0, input.texture);
    this.applyParams(program, def.params, effect.params, 1);
    this.ctx.drawQuad();
    return out;
  }

  private blend(source: RenderTarget, target: RenderTarget | null) {
    const gl = this.ctx.gl;
    const program = this.ctx.program(COPY);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program);
    this.bindTexture(program, 'u_image', 0, source.texture);
    gl.uniform1f(this.ctx.uniform(program, 'u_opacity'), 1);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.ctx.drawQuad();
    gl.disable(gl.BLEND);
  }

  private bindTexture(program: WebGLProgram, name: string, unit: number, texture: WebGLTexture, target: number = this.ctx.gl.TEXTURE_2D) {
    const gl = this.ctx.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, texture);
    gl.uniform1i(this.ctx.uniform(program, name), unit);
  }

  private applyParams(program: WebGLProgram, specs: readonly ParamSpec[], values: ParamValues, firstUnit: number) {
    const gl = this.ctx.gl;
    let unit = firstUnit;
    for (const spec of specs) {
      const value: ParamValue = values[spec.name] ?? (spec.default as ParamValue);
      const loc = this.ctx.uniform(program, spec.name);
      switch (spec.type) {
        case 'resource': {
          const texture = this.luts.get(String(value), this.lutProvider.lut(String(value)));
          if (texture) this.bindTexture(program, spec.name, unit++, texture, gl.TEXTURE_3D);
          break;
        }
        case 'enum':
          gl.uniform1i(loc, Math.max(0, spec.options.findIndex((o) => o.value === value)));
          break;
        case 'bool':
          gl.uniform1i(loc, value ? 1 : 0);
          break;
        case 'int':
          gl.uniform1i(loc, Number(value));
          break;
        case 'float':
          gl.uniform1f(loc, Number(value));
          break;
        default: {
          const arr = (Array.isArray(value) ? value : [Number(value)]) as number[];
          if (spec.type === 'vec2') gl.uniform2fv(loc, arr);
          else if (spec.type === 'vec3') gl.uniform3fv(loc, arr);
          else gl.uniform4fv(loc, arr);
        }
      }
    }
  }

  private collect(frame: CompositionFrame) {
    const visible = new Set<string>();
    for (const layer of frame.layers) {
      visible.add(layer.base.placement.item.id);
      if (layer.transition) visible.add(layer.transition.incoming.placement.item.id);
    }
    for (const [id, upload] of this.uploads) {
      if (visible.has(id)) continue;
      upload.dispose();
      this.uploads.delete(id);
    }
  }

  dispose(): void {
    for (const upload of this.uploads.values()) upload.dispose();
    this.uploads.clear();
    this.targets.trim();
  }

  releaseLut(id: string): void {
    this.luts.delete(id);
  }
}
