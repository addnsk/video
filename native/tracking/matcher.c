#include <stdint.h>
#include <wasm_simd128.h>

static float sum4(v128_t v) {
  return wasm_f32x4_extract_lane(v, 0) + wasm_f32x4_extract_lane(v, 1) + wasm_f32x4_extract_lane(v, 2) + wasm_f32x4_extract_lane(v, 3);
}

static float score(const float *frame, int width, const float *template, int size, float template_norm, int x0, int y0) {
  int wide = size & ~3;
  double sum = 0;
  for (int y = 0; y < size; y++) {
    const float *row = frame + (y0 + y) * width + x0;
    v128_t acc = wasm_f32x4_splat(0);
    int x = 0;
    for (; x < wide; x += 4) acc = wasm_f32x4_add(acc, wasm_v128_load(row + x));
    float s = sum4(acc);
    for (; x < size; x++) s += row[x];
    sum += s;
  }
  float mean = (float)(sum / (size * size));
  v128_t m = wasm_f32x4_splat(mean);
  double cross = 0;
  double norm = 0;
  for (int y = 0; y < size; y++) {
    const float *row = frame + (y0 + y) * width + x0;
    const float *t = template + y * size;
    v128_t c = wasm_f32x4_splat(0);
    v128_t n = wasm_f32x4_splat(0);
    int x = 0;
    for (; x < wide; x += 4) {
      v128_t v = wasm_f32x4_sub(wasm_v128_load(row + x), m);
      c = wasm_f32x4_add(c, wasm_f32x4_mul(v, wasm_v128_load(t + x)));
      n = wasm_f32x4_add(n, wasm_f32x4_mul(v, v));
    }
    float cs = sum4(c);
    float ns = sum4(n);
    for (; x < size; x++) {
      float v = row[x] - mean;
      cs += v * t[x];
      ns += v * v;
    }
    cross += cs;
    norm += ns;
  }
  double denominator = __builtin_sqrt(norm) * template_norm;
  return denominator > 1e-6 ? (float)(cross / denominator) : 0;
}

void match_scores(const float *frame, int width, int height, const float *template, int size, float template_norm,
                  int left, int top, int span, float *scores) {
  for (int j = 0; j < span; j++) {
    for (int i = 0; i < span; i++) {
      int x0 = left + i;
      int y0 = top + j;
      scores[j * span + i] = (x0 < 0 || y0 < 0 || x0 + size > width || y0 + size > height)
        ? -2.0f
        : score(frame, width, template, size, template_norm, x0, y0);
    }
  }
}
