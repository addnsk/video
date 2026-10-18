import { glTransition } from '../gl-transitions';

export const TRANSITIONS = [
  glTransition('dissolve', 'Dissolve', `
vec4 transition(vec2 uv) {
  return mix(getFromColor(uv), getToColor(uv), progress);
}`),
  glTransition('fade-color', 'Dip to color', `
uniform vec3 color; // = vec3(0.0)
uniform float colorPhase; // = 0.4
vec4 transition(vec2 uv) {
  return mix(
    mix(vec4(color, 1.0), getFromColor(uv), smoothstep(1.0 - colorPhase, 0.0, progress)),
    mix(vec4(color, 1.0), getToColor(uv), smoothstep(colorPhase, 1.0, progress)),
    progress);
}`),
  glTransition('wipe', 'Wipe', `
uniform vec2 direction; // = vec2(1.0, 0.0)
uniform float smoothness; // = 0.1
vec4 transition(vec2 uv) {
  vec2 d = normalize(direction);
  float pos = dot(uv - 0.5, d) / (abs(d.x) * 0.5 + abs(d.y) * 0.5) * 0.5 + 0.5;
  float m = smoothstep(-smoothness, 0.0, progress * (1.0 + smoothness) - smoothness - pos);
  return mix(getFromColor(uv), getToColor(uv), m);
}`),
  glTransition('slide', 'Slide', `
uniform vec2 direction; // = vec2(-1.0, 0.0)
vec4 transition(vec2 uv) {
  vec2 p = uv + progress * sign(direction);
  vec2 f = fract(p);
  return mix(getToColor(f), getFromColor(f),
    step(0.0, p.y) * step(p.y, 1.0) * step(0.0, p.x) * step(p.x, 1.0));
}`),
  glTransition('circle-open', 'Iris', `
uniform float smoothness; // = 0.3
uniform bool opening; // = true
vec4 transition(vec2 uv) {
  float x = opening ? progress : 1.0 - progress;
  float m = smoothstep(-smoothness, 0.0, 1.41421356 * distance(vec2(0.5), uv) - x * (1.0 + smoothness));
  return mix(getFromColor(uv), getToColor(uv), opening ? 1.0 - m : m);
}`),
  glTransition('zoom', 'Zoom', `
uniform float strength; // = 0.4
vec4 transition(vec2 uv) {
  float p = smoothstep(0.0, 1.0, progress);
  vec2 from = (uv - 0.5) / (1.0 + strength * p) + 0.5;
  vec2 to = (uv - 0.5) / (1.0 + strength * (1.0 - p)) + 0.5;
  return mix(getFromColor(from), getToColor(to), p);
}`),
];
