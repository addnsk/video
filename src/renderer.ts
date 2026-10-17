import { type Grade, type Lut, wheelToRgb } from './grade';
import { getTransition } from './transitions';
import type { Transition } from './project';

const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

// Цепочка: входное преобразование -> экспозиция и баланс белого ->
// lift/gamma/gain -> контраст -> насыщенность -> LUT.
const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 outColor;
uniform sampler2D src;
uniform sampler3D lut;
uniform int inputTransform;
uniform float exposure;
uniform vec3 balance;
uniform vec3 lift;
uniform vec3 gamma;
uniform vec3 gain;
uniform float contrast;
uniform float pivot;
uniform float saturation;
uniform float lutSize;
uniform float lutMix;
uniform bool bypass;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// Blackmagic Film Generation 5: лог -> линейный свет.
vec3 bmdGen5ToLinear(vec3 x) {
  const float A = 0.08692876065491224;
  const float B = 0.005494072432257808;
  const float C = 0.5300133392291939;
  const float D = 8.283605932402494;
  const float E = 0.09246575342465753;
  const float CUT = D * 0.005 + E;
  vec3 lo = (x - E) / D;
  vec3 hi = exp((x - C) / A) - B;
  return mix(lo, hi, step(CUT, x));
}

vec3 rec709Oetf(vec3 l) {
  l = max(l, 0.0);
  return mix(4.5 * l, 1.099 * pow(l, vec3(0.45)) - 0.099, step(0.018, l));
}

// Упрощённое преобразование BMD Film Gen5 в Rec.709: мягкое плечо,
// серая карта 18% остаётся на месте, плюс компенсация широкого охвата.
vec3 bmdFilmToRec709(vec3 x) {
  vec3 l = bmdGen5ToLinear(x);
  l = l / (l + 0.82);
  vec3 c = rec709Oetf(l);
  float y = dot(c, LUMA);
  return mix(vec3(y), c, 1.3);
}

void main() {
  vec3 c = texture(src, uv).rgb;
  if (!bypass) {
    if (inputTransform == 1) c = bmdFilmToRec709(c);
    c *= exp2(exposure) * balance;
    c = gain * (c + lift * (1.0 - c));
    c = sign(c) * pow(abs(c), 1.0 / gamma);
    c = (c - pivot) * contrast + pivot;
    float y = dot(c, LUMA);
    c = mix(vec3(y), c, saturation);
    if (lutSize > 0.0) {
      vec3 coord = clamp(c, 0.0, 1.0) * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize;
      c = mix(c, texture(lut, coord).rgb, lutMix);
    }
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const COPY = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D fromTex;
void main() { outColor = texture(fromTex, vec2(uv.x, 1.0 - uv.y)); }`;

// Обёртка gl-transitions. Кадры лежат во framebuffer'ах в координатах GL
// (начало внизу слева), как и ожидают переходы.
const transitionSource = (glsl: string) => `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D fromTex;
uniform sampler2D toTex;
uniform float progress;
uniform float ratio;
vec4 getFromColor(vec2 p) { return texture(fromTex, p); }
vec4 getToColor(vec2 p) { return texture(toTex, p); }
${glsl}
void main() { outColor = vec4(transition(vec2(uv.x, 1.0 - uv.y)).rgb, 1.0); }`;

export interface LayerDraw {
  grade: Grade;
}

export interface TransitionDraw {
  transition: Transition;
  progress: number;
}

interface Slot {
  source: WebGLTexture;
  target: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  loaded: boolean;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private grading: WebGLProgram;
  private copy: WebGLProgram;
  private transitions = new Map<string, WebGLProgram | Error>();
  private slots: Slot[];
  private lutTex: WebGLTexture;
  private lutRef: Lut | null = null;
  private uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private halfFloat = true;
  private floatTargets: boolean;
  private targetSize = { width: 0, height: 0 };
  onError: (message: string) => void = () => {};

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('Нужен браузер с поддержкой WebGL2.');
    this.gl = gl;
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    this.grading = this.link(FRAG);
    this.copy = this.link(COPY);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.lutTex = this.texture(gl.TEXTURE_3D);
    this.slots = [0, 1].map(() => ({
      source: this.texture(gl.TEXTURE_2D),
      target: this.texture(gl.TEXTURE_2D),
      fbo: gl.createFramebuffer()!,
      width: 0,
      height: 0,
      loaded: false,
    }));
  }

  private link(frag: string) {
    const gl = this.gl;
    const p = gl.createProgram()!;
    for (const [type, code] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, frag]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  private texture(target: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(target, t);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return t;
  }

  private u(program: WebGLProgram, name: string) {
    let m = this.uniforms.get(program);
    if (!m) this.uniforms.set(program, (m = new Map()));
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(program, name));
    return m.get(name)!;
  }

  /** Загружает кадр в половинную точность, чтобы 10 бит не обрезались до 8. */
  upload(slot: number, source: TexImageSource, width: number, height: number) {
    const gl = this.gl;
    const s = this.slots[slot];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.source);
    if (this.halfFloat) {
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, source);
        if (gl.getError() !== gl.NO_ERROR) throw new Error();
      } catch {
        this.halfFloat = false;
      }
    }
    if (!this.halfFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    s.width = width;
    s.height = height;
    s.loaded = true;
  }

  clear() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const s of this.slots) s.loaded = false;
  }

  get hasFrame() {
    return this.slots[0].loaded;
  }

  private ensureTargets() {
    const { width, height } = this.canvas;
    if (this.targetSize.width === width && this.targetSize.height === height) return;
    const gl = this.gl;
    for (const s of this.slots) {
      gl.bindTexture(gl.TEXTURE_2D, s.target);
      if (this.floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.target, 0);
    }
    this.targetSize = { width, height };
  }

  private setLut(lut: Lut | null) {
    if (lut === this.lutRef) return;
    this.lutRef = lut;
    if (!lut) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
  }

  /** Красит кадр из слота и вписывает его в framebuffer слота. */
  private gradeSlot(slot: number, grade: Grade, bypass: boolean) {
    const gl = this.gl;
    const s = this.slots[slot];
    const { width: cw, height: ch } = this.canvas;
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!s.loaded) return;
    const scale = Math.min(cw / s.width, ch / s.height);
    const w = Math.round(s.width * scale);
    const h = Math.round(s.height * scale);
    gl.viewport(Math.round((cw - w) / 2), Math.round((ch - h) / 2), w, h);

    const p = this.grading;
    gl.useProgram(p);
    this.setLut(grade.lut);
    const lift = wheelToRgb(grade.lift).map((v) => v * 0.25 + grade.lift.master * 0.5);
    const gamma = wheelToRgb(grade.gamma).map((v) => Math.max(0.05, 1 + v * 0.6 + grade.gamma.master));
    const gain = wheelToRgb(grade.gain).map((v) => Math.max(0, 1 + v * 0.6 + grade.gain.master));
    const t = grade.temperature * 0.25;
    const tint = grade.tint * 0.2;

    gl.uniform1i(this.u(p, 'src'), 0);
    gl.uniform1i(this.u(p, 'lut'), 1);
    gl.uniform1i(this.u(p, 'inputTransform'), grade.input === 'bmdFilmGen5' ? 1 : 0);
    gl.uniform1f(this.u(p, 'exposure'), grade.exposure);
    gl.uniform3f(this.u(p, 'balance'), 1 + t, 1 - tint, 1 - t);
    gl.uniform3fv(this.u(p, 'lift'), lift);
    gl.uniform3fv(this.u(p, 'gamma'), gamma);
    gl.uniform3fv(this.u(p, 'gain'), gain);
    gl.uniform1f(this.u(p, 'contrast'), grade.contrast);
    gl.uniform1f(this.u(p, 'pivot'), grade.pivot);
    gl.uniform1f(this.u(p, 'saturation'), grade.saturation);
    gl.uniform1f(this.u(p, 'lutSize'), grade.lut ? grade.lut.size : 0);
    gl.uniform1f(this.u(p, 'lutMix'), grade.lutMix);
    gl.uniform1i(this.u(p, 'bypass'), bypass ? 1 : 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.source);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private transitionProgram(id: string): WebGLProgram | null {
    const def = getTransition(id);
    if (!def) return null;
    const key = `${id}\n${def.glsl}`;
    let p = this.transitions.get(key);
    if (!p) {
      try {
        p = this.link(transitionSource(def.glsl));
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.onError(`Переход «${def.name}» не компилируется: ${err.message}`);
        p = err;
      }
      this.transitions.set(key, p);
    }
    return p instanceof Error ? null : p;
  }

  /**
   * Рисует кадр: один клип или переход между двумя.
   * Кадры к этому моменту загружены в слоты 0 (уходящий) и 1 (входящий).
   */
  draw(from: LayerDraw | null, to?: LayerDraw & TransitionDraw, bypass = false) {
    const gl = this.gl;
    if (!from || !this.slots[0].loaded) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    this.ensureTargets();
    this.gradeSlot(0, from.grade, bypass);
    const program = to && this.slots[1].loaded ? this.transitionProgram(to.transition.type) : null;
    if (to && program) this.gradeSlot(1, to.grade, bypass);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.slots[0].target);
    if (to && program) {
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.slots[1].target);
      gl.uniform1i(this.u(program, 'fromTex'), 0);
      gl.uniform1i(this.u(program, 'toTex'), 2);
      gl.uniform1f(this.u(program, 'progress'), Math.min(1, Math.max(0, to.progress)));
      gl.uniform1f(this.u(program, 'ratio'), this.canvas.width / this.canvas.height);
      const def = getTransition(to.transition.type)!;
      for (const param of def.params) {
        const v = to.transition.params[param.name] ?? param.default;
        const loc = this.u(program, param.name);
        const arr = Array.isArray(v) ? v : [v];
        if (param.type === 'int' || param.type === 'bool') gl.uniform1i(loc, arr[0]);
        else if (param.type === 'float') gl.uniform1f(loc, arr[0]);
        else if (param.type === 'vec2') gl.uniform2fv(loc, arr);
        else if (param.type === 'vec3') gl.uniform3fv(loc, arr);
        else gl.uniform4fv(loc, arr);
      }
    } else {
      gl.useProgram(this.copy);
      gl.uniform1i(this.u(this.copy, 'fromTex'), 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
  }
}
