import { type Grade, type Lut, wheelToRgb } from './grade';

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

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private frameTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private lutRef: Lut | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private halfFloat = true;
  hasFrame = false;
  srcWidth = 0;
  srcHeight = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('Нужен браузер с поддержкой WebGL2.');
    this.gl = gl;
    this.program = this.link();
    gl.useProgram(this.program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, 'pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.frameTex = this.texture(gl.TEXTURE_2D);
    this.lutTex = this.texture(gl.TEXTURE_3D);
    gl.uniform1i(this.u('src'), 0);
    gl.uniform1i(this.u('lut'), 1);
  }

  private link() {
    const gl = this.gl;
    const p = gl.createProgram()!;
    for (const [type, code] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(p, s);
    }
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

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  /** Загружает кадр в половинную точность, чтобы 10 бит не обрезались до 8. */
  upload(source: TexImageSource, width: number, height: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    if (this.halfFloat) {
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, source);
        if (gl.getError() !== gl.NO_ERROR) throw new Error();
      } catch {
        this.halfFloat = false;
      }
    }
    if (!this.halfFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.srcWidth = width;
    this.srcHeight = height;
    this.hasFrame = true;
  }

  clear() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.hasFrame = false;
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
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Рисует последний загруженный кадр с покраской, вписывая его в холст. */
  draw(grade: Grade | undefined, bypass = false) {
    const gl = this.gl;
    const { width: cw, height: ch } = this.canvas;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.hasFrame || !grade) return;

    const scale = Math.min(cw / this.srcWidth, ch / this.srcHeight);
    const w = Math.round(this.srcWidth * scale);
    const h = Math.round(this.srcHeight * scale);
    gl.viewport(Math.round((cw - w) / 2), Math.round((ch - h) / 2), w, h);

    this.setLut(grade.lut);
    const lift = wheelToRgb(grade.lift).map((v) => v * 0.25 + grade.lift.master * 0.5);
    const gamma = wheelToRgb(grade.gamma).map((v) => Math.max(0.05, 1 + v * 0.6 + grade.gamma.master));
    const gain = wheelToRgb(grade.gain).map((v) => Math.max(0, 1 + v * 0.6 + grade.gain.master));
    const t = grade.temperature * 0.25;
    const tint = grade.tint * 0.2;

    gl.uniform1i(this.u('inputTransform'), grade.input === 'bmdFilmGen5' ? 1 : 0);
    gl.uniform1f(this.u('exposure'), grade.exposure);
    gl.uniform3f(this.u('balance'), 1 + t, 1 - tint, 1 - t);
    gl.uniform3fv(this.u('lift'), lift);
    gl.uniform3fv(this.u('gamma'), gamma);
    gl.uniform3fv(this.u('gain'), gain);
    gl.uniform1f(this.u('contrast'), grade.contrast);
    gl.uniform1f(this.u('pivot'), grade.pivot);
    gl.uniform1f(this.u('saturation'), grade.saturation);
    gl.uniform1f(this.u('lutSize'), grade.lut ? grade.lut.size : 0);
    gl.uniform1f(this.u('lutMix'), grade.lutMix);
    gl.uniform1i(this.u('bypass'), bypass ? 1 : 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
