import { resolveItem } from '../../core/resolve';
import type { ColorScience, EffectInstance, Item, ParamValue, ParamValues, Project, Transform } from '../../core/model';
import type { CompositionFrame, LayerFrame, TrackFrame } from '../../core/timeline';
import type { EffectRegistry } from '../../effects/registry';
import { defaultParams, type FilterDef, type NodeDef, type ParamSpec, type TransitionDef } from '../../effects/types';
import type { FrameImage } from '../media/frame';
import type { GpuContext } from './context';
import { COPY, FIT, PRESENT, filterSource, nodeHasUniform, nodeInputUniform, nodeSource, transitionSource } from './shaders';
import { OUTPUT_ID, materialize } from '../../core/graph';
import { renderGraph } from './graph-renderer';
import { sampleCurve } from '../../effects/curves';
import { bezierPath, catmullRom } from '../../effects/points';
import { RasterTextures, type Rasterizer } from './raster';
import { needsInputTransform } from '../../effects/color-management';
import { itemColorSpace } from '../../core/model';
import { CurveTextures, LutTextures, TargetPool, UploadTexture, type RenderTarget } from './textures';

export interface LutProvider {
  lut(id: string): { size: number; data: Float32Array } | undefined;
}

export interface FullFrame {
  readonly data: Float32Array | Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly bottomUp: true;
  readonly overBlack: true;
}

export interface ViewNode {
  readonly itemId: string;
  readonly nodeId: string;
}

export interface RenderOptions {
  readonly bypassFilters?: boolean;
  readonly viewNode?: ViewNode | null;
  readonly capture?: (pixels: Uint8Array, width: number, height: number) => void;
  readonly readback?: (frame: FullFrame) => void;
}

const CAPTURE_WIDTH = 320;
const NODE_CACHE_ENTRIES = 12;

const sources = new WeakMap<FilterDef | TransitionDef, string>();
const sourceOf = (def: FilterDef | TransitionDef) => {
  let s = sources.get(def);
  if (!s) sources.set(def, (s = def.kind === 'filter' ? filterSource(def) : transitionSource(def)));
  return s;
};

const nodeSources = new WeakMap<NodeDef, string[]>();
const nodeSourceOf = (def: NodeDef, pass: number) => {
  let list = nodeSources.get(def);
  if (!list) nodeSources.set(def, (list = def.passes.map((_, i) => nodeSource(def, i))));
  return list[pass];
};

export class Compositor {
  private targets: TargetPool;
  private uploads = new Map<string, UploadTexture>();
  private luts: LutTextures;
  private curves: CurveTextures;
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
    this.curves = new CurveTextures(ctx);
    this.rasterTextures = new RasterTextures(ctx);
  }

  private rasterTextures: RasterTextures;
  private colorScience: ColorScience = 'display';
  private assets: Project['assets'] = {};

  setProject(project: Project): void {
    if (project.settings) this.setFrame(project.settings.width, project.settings.height);
    this.colorScience = project.settings?.colorScience ?? 'display';
    this.frameInterval = 1 / (project.settings?.fps || 25);
    this.assets = project.assets;
  }

  private inputTransform(item: Item, input: RenderTarget): RenderTarget {
    const space = itemColorSpace(item, this.assets);
    if (!needsInputTransform(this.colorScience, space)) return input;
    const out = this.applyFilter({ id: 'input-transform', type: 'input-transform', enabled: true, params: { space: space ?? 'rec709', science: this.colorScience } }, input);
    if (out !== input) this.targets.release(input);
    return out;
  }

  private generated(def: NodeDef, output: RenderTarget): RenderTarget {
    if (def.category !== 'generator' || this.colorScience !== 'aces') return output;
    const out = this.applyFilter({ id: 'input-transform', type: 'input-transform', enabled: true, params: { space: 'rec709', science: 'aces' } }, output);
    if (out !== output) this.targets.release(output);
    return out;
  }

  private outputTransform(input: RenderTarget): RenderTarget {
    if (this.colorScience !== 'aces') return input;
    const out = this.applyFilter({ id: 'output-transform', type: 'output-transform', enabled: true, params: {} }, input);
    if (out !== input) this.targets.release(input);
    return out;
  }
  private nodeTime = 0;
  private localTime = 0;
  private rasterizers = new Map<string, Rasterizer>();

  registerRasterizer(id: string, rasterizer: Rasterizer): void {
    this.rasterizers.set(id, rasterizer);
  }

  private project: { width: number; height: number } | null = null;
  private pixelScale = 1;

  setFrame(width: number, height: number): void {
    this.project = width > 0 && height > 0 ? { width, height } : null;
  }

  get size(): { width: number; height: number } {
    const surface = this.ctx.surface;
    if (!this.project) return { width: surface.width, height: surface.height };
    const aspect = this.project.width / this.project.height;
    const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
    return surface.width / surface.height > aspect
      ? { width: even(surface.height * aspect), height: even(surface.height) }
      : { width: even(surface.width), height: even(surface.width / aspect) };
  }

  render(frame: CompositionFrame, images: ReadonlyMap<string, FrameImage>, options: RenderOptions = {}): void {
    const gl = this.ctx.gl;
    if (this.ctx.lost) return;
    const size = this.size;
    this.width = size.width;
    this.height = size.height;
    this.pixelScale = this.project ? size.height / this.project.height : 1;
    let accumulator: RenderTarget | null = null;
    this.passes = 0;
    for (const layer of frame.layers) {
      const result = this.renderTrack(layer, images, options);
      if (!result) continue;
      const opacity = layer.transition ? 1 : resolveItem(layer.base.placement.item, layer.base.local).opacity;
      if (!accumulator && opacity >= 1) {
        accumulator = result;
        continue;
      }
      if (!accumulator) {
        accumulator = this.targets.acquire(this.width, this.height);
        this.clearTarget(accumulator);
      }
      this.blend(result, accumulator, opacity);
      this.targets.release(result);
    }
    if (accumulator) accumulator = this.outputTransform(accumulator);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.ctx.surface.width, this.ctx.surface.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (options.readback) options.readback(this.readFull(accumulator));
    if (accumulator) {
      if (options.capture) this.capture(accumulator, options.capture);
      this.blend(accumulator, null);
      this.targets.release(accumulator);
    }
    this.collect(frame);
    this.releaseEvicted();
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
    const resolved = resolveItem(item, layer.local);
    this.nodeTime = layer.sourceTime;
    this.localTime = layer.local;
    const source = () => this.inputTransform(item, this.fit(texture, image.width, image.height, resolved.transform));
    if (options.bypassFilters) return source();
    const registry = this.registry;
    const graph = materialize(resolved.effects, item.graph, registry);
    const viewed = options.viewNode?.itemId === item.id && graph.nodes.some((n) => n.id === options.viewNode!.nodeId) ? options.viewNode.nodeId : OUTPUT_ID;
    return renderGraph<RenderTarget>(
      graph,
      viewed,
      registry,
      {
        source,
        filter: (_def, effect, input) => this.applyFilter(effect, input),
        node: (def, params, inputs, nodeId) => this.generated(def, this.renderNode(def, params, inputs, `${item.id}:${nodeId}`)),
        release: (target) => this.targets.release(target),
        copy: (target) => this.copyTarget(target),
      },
      this.nodeCacheFor(),
    );
  }

  private nodeCache = new Map<string, RenderTarget>();
  private evicted: RenderTarget[] = [];

  private releaseEvicted() {
    for (const target of this.evicted) this.targets.release(target);
    this.evicted = [];
  }
  private nodeCacheGeneration = -1;

  private nodeCacheFor() {
    if (this.nodeCacheGeneration !== this.ctx.generation) {
      this.nodeCache.clear();
      this.nodeCacheGeneration = this.ctx.generation;
    }
    const prefix = `${this.width}x${this.height}:${this.pixelScale}:`;
    return {
      get: (key: string) => {
        const hit = this.nodeCache.get(prefix + key);
        if (hit) {
          this.nodeCache.delete(prefix + key);
          this.nodeCache.set(prefix + key, hit);
        }
        return hit;
      },
      put: (key: string, target: RenderTarget) => {
        this.nodeCache.set(prefix + key, target);
        for (const [k, t] of this.nodeCache) {
          if (this.nodeCache.size <= NODE_CACHE_ENTRIES) break;
          this.nodeCache.delete(k);
          this.evicted.push(t);
        }
      },
    };
  }

  get nodeCacheBytes(): number {
    let bytes = 0;
    for (const t of this.nodeCache.values()) bytes += t.width * t.height * (this.ctx.floatTargets ? 8 : 4);
    return bytes;
  }

  trimNodeCache(): void {
    for (const t of this.nodeCache.values()) this.targets.release(t);
    this.nodeCache.clear();
  }

  private copyTarget(source: RenderTarget): RenderTarget {
    const gl = this.ctx.gl;
    const out = this.targets.acquire(this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    const program = this.ctx.program(COPY);
    gl.useProgram(program);
    this.bindTexture(program, 'u_image', 0, source.texture);
    gl.uniform1f(this.ctx.uniform(program, 'u_opacity'), 1);
    gl.disable(gl.BLEND);
    this.ctx.drawQuad();
    return out;
  }

  private histories = new Map<string, { target: RenderTarget; time: number }>();
  frameInterval = 1 / 25;

  get historyBytes(): number {
    let bytes = 0;
    for (const { target } of this.histories.values()) bytes += target.width * target.height * (this.ctx.floatTargets ? 8 : 4);
    return bytes;
  }

  trimHistories(): void {
    for (const { target } of this.histories.values()) this.targets.release(target);
    this.histories.clear();
  }

  private historiesGeneration = -1;

  private historyFor(key: string): RenderTarget | null {
    if (this.historiesGeneration !== this.ctx.generation) {
      this.histories.clear();
      this.historiesGeneration = this.ctx.generation;
    }
    const entry = this.histories.get(key);
    if (!entry) return null;
    const step = this.localTime - entry.time;
    const valid = entry.target.width === this.width && entry.target.height === this.height && step > 0 && step <= this.frameInterval * 1.5;
    return valid ? entry.target : null;
  }

  private keepHistory(key: string, output: RenderTarget) {
    const old = this.histories.get(key);
    if (old) this.evicted.push(old.target);
    this.histories.set(key, { target: this.copyTarget(output), time: this.localTime });
  }

  private renderNode(def: NodeDef, params: ParamValues, inputs: ReadonlyMap<string, RenderTarget>, key: string): RenderTarget {
    const gl = this.ctx.gl;
    let previous: RenderTarget | null = null;
    const history = def.history ? this.historyFor(key) : null;
    for (let pass = 0; pass < def.passes.length; pass++) {
      const out = this.targets.acquire(this.width, this.height);
      this.passes++;
      let program: WebGLProgram;
      try {
        program = this.ctx.program(nodeSourceOf(def, pass));
      } catch (e) {
        this.onError(`Node "${def.name}": ${(e as Error).message}`);
        this.clearTarget(out);
        if (previous) this.targets.release(previous);
        return out;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(this.ctx.uniform(program, 'u_resolution'), this.width, this.height);
      gl.uniform1f(this.ctx.uniform(program, 'u_pixel_scale'), this.pixelScale);
      gl.uniform1f(this.ctx.uniform(program, 'u_time'), this.nodeTime);
      gl.uniform1i(this.ctx.uniform(program, 'u_aces'), this.colorScience === 'aces' ? 1 : 0);
      let unit = 0;
      for (const { name } of def.inputs) {
        const input = inputs.get(name);
        gl.uniform1i(this.ctx.uniform(program, nodeHasUniform(name)), input ? 1 : 0);
        this.bindTexture(program, nodeInputUniform(name), unit, input?.texture ?? this.emptyTexture(unit));
        unit++;
      }
      if (previous) this.bindTexture(program, 'u_previous', unit++, previous.texture);
      if (def.history) {
        gl.uniform1i(this.ctx.uniform(program, 'u_has_history'), history ? 1 : 0);
        this.bindTexture(program, 'u_history', unit, history?.texture ?? this.emptyTexture(unit));
        unit++;
      }
      if (def.raster) unit = this.bindRaster(program, def.raster, { ...defaultParams(def.params), ...params }, unit);
      this.applyParams(program, def.params, params, unit);
      this.ctx.drawQuad();
      if (previous) this.targets.release(previous);
      previous = out;
    }
    const result = previous ?? this.blankTarget();
    if (def.history) this.keepHistory(key, result);
    return result;
  }

  private presented: UploadTexture | null = null;
  passes = 0;

  present(bitmap: ImageBitmap, capture?: RenderOptions['capture']): boolean {
    const gl = this.ctx.gl;
    if (this.ctx.lost || !bitmap.width) return false;
    this.presented ??= new UploadTexture(this.ctx);
    gl.activeTexture(gl.TEXTURE0);
    const texture = this.presented.upload(bitmap, bitmap.width, bitmap.height, '');
    const program = this.ctx.program(PRESENT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.ctx.surface.width, this.ctx.surface.height);
    gl.useProgram(program);
    this.bindTexture(program, 'u_image', 0, texture);
    this.ctx.drawQuad();
    if (capture) {
      this.capture({ texture } as RenderTarget, capture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.ctx.surface.width, this.ctx.surface.height);
    }
    return true;
  }

  private compareTexture: UploadTexture | null = null;

  drawCompare(bitmap: ImageBitmap, position: number): void {
    const gl = this.ctx.gl;
    if (this.ctx.lost || !bitmap.width || position <= 0) return;
    this.compareTexture ??= new UploadTexture(this.ctx);
    gl.activeTexture(gl.TEXTURE0);
    const texture = this.compareTexture.upload(bitmap, bitmap.width, bitmap.height, `compare:${bitmap.width}x${bitmap.height}`);
    const surface = this.ctx.surface;
    const size = this.size;
    const x = Math.round((surface.width - size.width) / 2);
    const y = Math.round((surface.height - size.height) / 2);
    const program = this.ctx.program(PRESENT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(x, y, size.width, size.height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, Math.round(size.width * Math.min(1, position)), size.height);
    gl.useProgram(program);
    this.bindTexture(program, 'u_image', 0, texture);
    this.ctx.drawQuad();
    gl.disable(gl.SCISSOR_TEST);
  }

  get surface(): { readonly width: number; readonly height: number } {
    return this.ctx.surface;
  }

  snapshot(): Promise<ImageBitmap> {
    return createImageBitmap(this.ctx.surface as OffscreenCanvas);
  }

  private bindRaster(program: WebGLProgram, id: string, params: ParamValues, unit: number): number {
    const gl = this.ctx.gl;
    const rasterizer = this.rasterizers.get(id);
    if (!rasterizer) {
      this.bindTexture(program, 'u_raster', unit, this.emptyTexture(unit));
      this.bindTexture(program, 'u_atlas', unit + 1, this.emptyTexture(unit + 1));
      this.bindTexture(program, 'u_glyph_data', unit + 2, this.emptyTexture(unit + 2));
      gl.uniform1i(this.ctx.uniform(program, 'u_glyph_count'), 0);
      return unit + 3;
    }
    const image = rasterizer.rasterize(params, this.width, this.height, this.pixelScale);
    gl.activeTexture(gl.TEXTURE0 + unit);
    this.bindTexture(program, 'u_raster', unit, this.rasterTextures.get(image));
    gl.activeTexture(gl.TEXTURE0 + unit + 1);
    this.bindTexture(program, 'u_atlas', unit + 1, image.atlas ? this.rasterTextures.get(image.atlas) : this.emptyTexture(unit + 1));
    gl.activeTexture(gl.TEXTURE0 + unit + 2);
    this.bindTexture(program, 'u_glyph_data', unit + 2, this.rasterTextures.glyphData(image, unit + 2));
    gl.useProgram(program);
    gl.uniform1i(this.ctx.uniform(program, 'u_glyph_count'), image.atlas ? image.count : 0);
    return unit + 3;
  }

  private empty: { texture: WebGLTexture; generation: number } | null = null;

  private emptyTexture(unit: number): WebGLTexture {
    if (this.empty?.generation === this.ctx.generation) return this.empty.texture;
    const gl = this.ctx.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.empty = { texture, generation: this.ctx.generation };
    return texture;
  }

  private blankTarget(): RenderTarget {
    const target = this.targets.acquire(this.width, this.height);
    this.clearTarget(target);
    return target;
  }

  private fit(texture: WebGLTexture, width: number, height: number, transform: Transform): RenderTarget {
    const gl = this.ctx.gl;
    const out = this.targets.acquire(this.width, this.height);
    const scale = Math.min(this.width / width, this.height / height) * Math.max(0.001, transform.scale);
    const angle = (transform.rotation * Math.PI) / 180;
    const program = this.ctx.program(FIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    this.bindTexture(program, 'u_image', 0, texture);
    gl.uniform2f(this.ctx.uniform(program, 'u_size'), this.width, this.height);
    gl.uniform2f(this.ctx.uniform(program, 'u_center'), this.width * (0.5 + transform.x), this.height * (0.5 - transform.y));
    gl.uniform2f(this.ctx.uniform(program, 'u_extent'), width * scale, height * scale);
    gl.uniform2f(this.ctx.uniform(program, 'u_rotation'), Math.cos(angle), Math.sin(angle));
    this.ctx.drawQuad();
    return out;
  }

  private clearTarget(target: RenderTarget) {
    const gl = this.ctx.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
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
    this.passes++;
    const out = this.targets.acquire(this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program);
    this.bindTexture(program, 'u_source', 0, input.texture);
    gl.uniform1i(this.ctx.uniform(program, 'u_aces'), this.colorScience === 'aces' ? 1 : 0);
    this.applyParams(program, def.params, effect.params, 1);
    this.ctx.drawQuad();
    return out;
  }

  private blend(source: RenderTarget, target: RenderTarget | null, opacity = 1) {
    const gl = this.ctx.gl;
    const program = this.ctx.program(COPY);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    if (target) gl.viewport(0, 0, this.width, this.height);
    else {
      const surface = this.ctx.surface;
      gl.viewport(Math.round((surface.width - this.width) / 2), Math.round((surface.height - this.height) / 2), this.width, this.height);
    }
    gl.useProgram(program);
    this.bindTexture(program, 'u_image', 0, source.texture);
    gl.uniform1f(this.ctx.uniform(program, 'u_opacity'), opacity);
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
          gl.activeTexture(gl.TEXTURE0 + unit);
          const texture = this.luts.get(String(value), this.lutProvider.lut(String(value)));
          if (texture) this.bindTexture(program, spec.name, unit++, texture, gl.TEXTURE_3D);
          break;
        }
        case 'curve': {
          const points = (Array.isArray(value) ? value : spec.default) as number[];
          gl.activeTexture(gl.TEXTURE0 + unit);
          const texture = this.curves.get(`${spec.periodic ? 'p' : 'l'}:${points.join(',')}`, () => sampleCurve(points, 256, spec.periodic));
          this.bindTexture(program, spec.name, unit++, texture);
          break;
        }
        case 'text':
          break;
        case 'enum':
          gl.uniform1i(loc, Math.max(0, spec.options.findIndex((o) => o.value === value)));
          break;
        case 'points': {
          const raw = (Array.isArray(value) ? value : spec.default) as number[];
          const spline = values.spline ?? specs.find((s) => s.name === 'spline')?.default;
          const points = spec.bezier ? bezierPath(raw, true, 8, spec.max) : spline === true ? catmullRom(raw, true, 8, spec.max) : raw.slice(0, spec.max * 2);
          const data = new Float32Array(spec.max * 2);
          data.set(points);
          gl.uniform2fv(this.ctx.uniform(program, `${spec.name}[0]`), data);
          gl.uniform1i(this.ctx.uniform(program, `${spec.name}_count`), points.length / 2);
          break;
        }
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
          else if (spec.type === 'color') gl.uniform4fv(loc, arr.length === 4 ? arr : [...arr, 1, 1, 1, 1].slice(0, 4));
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

  private captureTarget: { texture: WebGLTexture; framebuffer: WebGLFramebuffer; buffer: WebGLBuffer; width: number; height: number; generation: number } | null = null;
  private captureBusy = false;
  private captureQueued: ((pixels: Uint8Array, width: number, height: number) => void) | null = null;

  private capture(source: RenderTarget, sink: (pixels: Uint8Array, width: number, height: number) => void) {
    const gl = this.ctx.gl;
    const width = CAPTURE_WIDTH;
    const height = Math.max(2, Math.round((CAPTURE_WIDTH * this.height) / this.width));
    let target = this.captureTarget;
    if (!target || target.width !== width || target.height !== height || target.generation !== this.ctx.generation) {
      if (target && target.generation === this.ctx.generation) {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteBuffer(target.buffer);
      }
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, width * height * 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      target = this.captureTarget = { texture, framebuffer, buffer, width, height, generation: this.ctx.generation };
    }
    const program = this.ctx.program(COPY);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    this.bindTexture(program, 'u_image', 0, source.texture);
    gl.uniform1f(this.ctx.uniform(program, 'u_opacity'), 1);
    this.ctx.drawQuad();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (this.captureBusy) this.captureQueued = sink;
    else this.readCapture(target, sink);
  }

  private readCapture(target: NonNullable<Compositor['captureTarget']>, sink: (pixels: Uint8Array, width: number, height: number) => void) {
    const gl = this.ctx.gl;
    const { width, height } = target;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, target.buffer);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    if (!fence) return;
    this.captureBusy = true;
    const poll = () => {
      if (target.generation !== this.ctx.generation || this.captureTarget !== target) {
        this.captureBusy = false;
        this.captureQueued = null;
        return;
      }
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) {
        setTimeout(poll, 4);
        return;
      }
      gl.deleteSync(fence);
      this.captureBusy = false;
      if (status !== gl.WAIT_FAILED) {
        const pixels = new Uint8Array(width * height * 4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, target.buffer);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        sink(pixels, width, height);
      }
      const queued = this.captureQueued;
      this.captureQueued = null;
      if (queued) this.readCapture(target, queued);
    };
    setTimeout(poll, 0);
  }

  private fullFrame: Float32Array | Uint8Array | null = null;

  private readFull(source: RenderTarget | null): FullFrame {
    const gl = this.ctx.gl;
    const float = this.ctx.floatTargets;
    const length = this.width * this.height * 4;
    if (!this.fullFrame || this.fullFrame.length !== length || this.fullFrame instanceof Float32Array !== float)
      this.fullFrame = float ? new Float32Array(length) : new Uint8Array(length);
    const data = this.fullFrame;
    if (source) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, source.framebuffer);
      gl.readPixels(0, 0, this.width, this.height, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, data);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else data.fill(0);
    return { data, width: this.width, height: this.height, scale: float ? 1 : 1 / 255, bottomUp: true, overBlack: true };
  }

  get idleTargetBytes(): number {
    return this.targets.idleBytes;
  }

  trimIdle(): void {
    this.targets.trim();
  }

  dispose(): void {
    this.trimNodeCache();
    this.trimHistories();
    this.fullFrame = null;
    for (const upload of this.uploads.values()) upload.dispose();
    this.uploads.clear();
    this.rasterTextures.clear();
    this.presented?.dispose();
    this.compareTexture?.dispose();
    this.compareTexture = null;
    this.presented = null;
    for (const rasterizer of this.rasterizers.values()) rasterizer.clear();
    this.targets.trim();
  }

  releaseLut(id: string): void {
    this.luts.delete(id);
  }
}
