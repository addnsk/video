import { Emitter } from '../../core/emitter';
import { VERTEX } from './shaders';

export type Surface = HTMLCanvasElement | OffscreenCanvas;

export interface GpuEvents extends Record<string, unknown> {
  lost: void;
  restored: void;
}

export class ShaderError extends Error {}

export class GpuContext extends Emitter<GpuEvents> {
  readonly gl: WebGL2RenderingContext;
  readonly floatTargets: boolean;
  generation = 0;
  lost = false;
  private programs = new Map<string, WebGLProgram | ShaderError>();
  private uniformCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private quad: WebGLBuffer | null = null;

  constructor(readonly surface: Surface) {
    super();
    const gl = surface.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    surface.addEventListener('webglcontextlost', ((e: Event) => {
      e.preventDefault();
      this.lost = true;
      this.emit('lost', undefined);
    }) as EventListener);
    surface.addEventListener('webglcontextrestored', (() => {
      this.lost = false;
      this.generation++;
      this.programs.clear();
      this.uniformCache.clear();
      this.quad = null;
      this.setup();
      this.emit('restored', undefined);
    }) as EventListener);
    this.setup();
  }

  private setup() {
    const gl = this.gl;
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  program(fragment: string): WebGLProgram {
    const cached = this.programs.get(fragment);
    if (cached instanceof ShaderError) throw cached;
    if (cached) return cached;
    try {
      const program = this.link(fragment);
      this.programs.set(fragment, program);
      return program;
    } catch (e) {
      const error = new ShaderError(e instanceof Error ? e.message : String(e));
      this.programs.set(fragment, error);
      throw error;
    }
  }

  uniform(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    let map = this.uniformCache.get(program);
    if (!map) this.uniformCache.set(program, (map = new Map()));
    if (!map.has(name)) map.set(name, this.gl.getUniformLocation(program, name));
    return map.get(name)!;
  }

  drawQuad(): void {
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  private link(fragment: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram()!;
    const shaders = [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const;
    for (const [type, source] of shaders) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) ?? 'compile error';
        gl.deleteShader(shader);
        gl.deleteProgram(program);
        throw new Error(log);
      }
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'link error';
      gl.deleteProgram(program);
      throw new Error(log);
    }
    return program;
  }
}
