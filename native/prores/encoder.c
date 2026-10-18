#include <stdint.h>
#include <wasm_simd128.h>

#define MB 16
#define SLICE_MBS 8
#define HEADER_BYTES 6
#define DC_CENTER 0x4000
#define BORROW 4.0
#define SCRATCH (1 << 17)
#define QUANTS 24

static const uint8_t SCAN[64] = {
  0, 1, 8, 9, 2, 3, 10, 11, 16, 17, 24, 25, 18, 19, 26, 27,
  4, 5, 12, 20, 13, 6, 7, 14, 21, 28, 29, 22, 15, 23, 30, 31,
  32, 33, 40, 48, 41, 34, 35, 42, 49, 56, 57, 50, 43, 36, 37, 44,
  51, 58, 59, 52, 45, 38, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
};
static const uint8_t DC_BOOKS[4] = {0x04, 0x28, 0x4d, 0x70};
static const uint8_t AC_BOOKS[7] = {0x04, 0x28, 0x4c, 0x05, 0x29, 0x06, 0x0a};
static const uint8_t RUN_BOOK[16] = {5, 5, 3, 3, 0, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 2};
static const uint8_t LEVEL_BOOK[10] = {0, 6, 3, 5, 0, 1, 1, 1, 1, 2};
static const uint8_t STEPS[QUANTS] = {1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128};

static double basis[64];
static int32_t blocks[3][SLICE_MBS * 4 * 64];
static uint8_t scratch[3][SCRATCH];

typedef struct {
  uint8_t *out;
  uint32_t length;
  uint64_t acc;
  uint32_t pending;
} Writer;

double *basis_table(void) { return basis; }

static void put(Writer *w, uint32_t bits, uint32_t value) {
  if (!bits) return;
  w->acc = (w->acc << bits) | (bits == 32 ? value : (value & ((1u << bits) - 1)));
  w->pending += bits;
  while (w->pending >= 8) {
    w->pending -= 8;
    if (w->length < SCRATCH) w->out[w->length] = (uint8_t)(w->acc >> w->pending);
    w->length++;
  }
  w->acc &= (1ull << w->pending) - 1;
}

static void zeros(Writer *w, int32_t count) {
  for (; count > 0; count -= 24) put(w, count < 24 ? count : 24, 0);
}

static void codeword(Writer *w, uint32_t book, uint32_t value) {
  uint32_t switch_bits = (book & 3) + 1;
  uint32_t rice = book >> 5;
  uint32_t exp_order = (book >> 2) & 7;
  uint32_t switch_value = switch_bits << rice;
  if (value >= switch_value) {
    uint32_t shifted = value - (switch_value - (1u << exp_order));
    int32_t exponent = 31 - __builtin_clz(shifted);
    zeros(w, exponent - (int32_t)exp_order + (int32_t)switch_bits);
    put(w, exponent + 1, shifted);
    return;
  }
  uint32_t exponent = value >> rice;
  if (exponent) zeros(w, exponent);
  put(w, 1, 1);
  if (rice) put(w, rice, value & ((1u << rice) - 1));
}

static double round_half_up(double x) {
  double r = __builtin_floor(x);
  return x - r >= 0.5 ? r + 1 : r;
}

static void dct(const double *in, int32_t *out) {
  double temp[64];
  for (int y = 0; y < 8; y++) {
    for (int k = 0; k < 8; k += 2) {
      v128_t sum = wasm_f64x2_splat(0);
      for (int n = 0; n < 8; n++) {
        v128_t b = wasm_f64x2_make(basis[k * 8 + n], basis[(k + 1) * 8 + n]);
        sum = wasm_f64x2_add(sum, wasm_f64x2_mul(b, wasm_f64x2_splat(in[y * 8 + n])));
      }
      temp[y * 8 + k] = wasm_f64x2_extract_lane(sum, 0);
      temp[y * 8 + k + 1] = wasm_f64x2_extract_lane(sum, 1);
    }
  }
  for (int k = 0; k < 8; k++) {
    for (int x = 0; x < 8; x += 2) {
      v128_t sum = wasm_f64x2_splat(0);
      v128_t b = wasm_f64x2_splat(0);
      for (int n = 0; n < 8; n++) {
        b = wasm_f64x2_splat(basis[k * 8 + n]);
        sum = wasm_f64x2_add(sum, wasm_f64x2_mul(b, wasm_v128_load(&temp[n * 8 + x])));
      }
      sum = wasm_f64x2_mul(sum, wasm_f64x2_splat(4.0));
      out[k * 8 + x] = (int32_t)round_half_up(wasm_f64x2_extract_lane(sum, 0));
      out[k * 8 + x + 1] = (int32_t)round_half_up(wasm_f64x2_extract_lane(sum, 1));
    }
  }
}

static void gather(const uint16_t *data, int width, int height, int luma, int mb_x, int mb_y, int mbs, int32_t *out) {
  static const int LUMA_ORIGINS[4][2] = {{0, 0}, {8, 0}, {0, 8}, {8, 8}};
  static const int CHROMA_ORIGINS[2][2] = {{0, 0}, {0, 8}};
  int per_mb = luma ? 4 : 2;
  int block_width = luma ? 16 : 8;
  double pixels[64];
  int block = 0;
  for (int m = 0; m < mbs; m++) {
    int x0 = (mb_x + m) * block_width;
    int y0 = mb_y * MB;
    for (int o = 0; o < per_mb; o++) {
      int bx = luma ? LUMA_ORIGINS[o][0] : CHROMA_ORIGINS[o][0];
      int by = luma ? LUMA_ORIGINS[o][1] : CHROMA_ORIGINS[o][1];
      for (int y = 0; y < 8; y++) {
        int sy = y0 + by + y;
        if (sy > height - 1) sy = height - 1;
        const uint16_t *row = data + sy * width;
        int sx = x0 + bx;
        if (sx + 7 < width) {
          v128_t v = wasm_v128_load(row + sx);
          v128_t lo = wasm_u32x4_extend_low_u16x8(v);
          v128_t hi = wasm_u32x4_extend_high_u16x8(v);
          wasm_v128_store(&pixels[y * 8 + 0], wasm_f64x2_convert_low_u32x4(lo));
          wasm_v128_store(&pixels[y * 8 + 2], wasm_f64x2_convert_low_u32x4(wasm_i32x4_shuffle(lo, lo, 2, 3, 0, 1)));
          wasm_v128_store(&pixels[y * 8 + 4], wasm_f64x2_convert_low_u32x4(hi));
          wasm_v128_store(&pixels[y * 8 + 6], wasm_f64x2_convert_low_u32x4(wasm_i32x4_shuffle(hi, hi, 2, 3, 0, 1)));
        } else {
          for (int x = 0; x < 8; x++) {
            int cx = sx + x;
            if (cx > width - 1) cx = width - 1;
            pixels[y * 8 + x] = row[cx];
          }
        }
      }
      dct(pixels, out + block * 64);
      block++;
    }
  }
}

static int32_t fold(int32_t v) { return (v * 2) ^ (v < 0 ? -1 : 0); }

static void encode_plane(Writer *w, const int32_t *data, int count, int scale) {
  w->length = 0;
  w->acc = 0;
  w->pending = 0;
  int32_t previous = (data[0] - DC_CENTER) / scale;
  codeword(w, 0xb8, fold(previous));
  int book = 3;
  int32_t last_sign = 0;
  for (int b = 1; b < count; b++) {
    int32_t dc = (data[b * 64] - DC_CENTER) / scale;
    int32_t delta = dc - previous;
    int32_t next_sign = delta < 0 ? -1 : 0;
    delta = (delta ^ last_sign) - last_sign;
    int32_t code = fold(delta);
    codeword(w, DC_BOOKS[book], code);
    int32_t nb = (code + (code & 1)) >> 1;
    book = nb < 3 ? nb : 3;
    last_sign = next_sign;
    previous = dc;
  }
  int run_book = RUN_BOOK[4];
  int level_book = LEVEL_BOOK[2];
  uint32_t run = 0;
  int total = count * 64;
  for (int i = 1; i < 64; i++) {
    for (int index = SCAN[i]; index < total; index += 64) {
      int32_t level = data[index] / scale;
      if (!level) {
        run++;
        continue;
      }
      uint32_t magnitude = level < 0 ? -level : level;
      codeword(w, AC_BOOKS[run_book], run);
      codeword(w, AC_BOOKS[level_book], magnitude - 1);
      put(w, 1, level < 0);
      run_book = RUN_BOOK[run < 15 ? run : 15];
      level_book = LEVEL_BOOK[magnitude < 9 ? magnitude : 9];
      run = 0;
    }
  }
  if (w->pending) put(w, 8 - w->pending, 0);
}

static void copy(uint8_t *to, const uint8_t *from, uint32_t n) {
  for (uint32_t i = 0; i < n; i++) to[i] = from[i];
}

static int fits(Writer *writers, const int *counts, int index, double budget) {
  double bits = 0;
  for (int p = 0; p < 3; p++) {
    encode_plane(&writers[p], blocks[p], counts[p], 4 * STEPS[index]);
    bits += writers[p].length * 8.0 + writers[p].pending;
  }
  return bits <= budget;
}

int32_t encode_frame(int width, int height, const uint16_t *y, const uint16_t *cb, const uint16_t *cr,
                     int bits_per_mb, int quant_start, uint8_t *out, uint32_t capacity) {
  int mb_width = (width + MB - 1) / MB;
  int mb_height = (height + MB - 1) / MB;
  int sizes[64];
  int xs[64];
  int columns = 0;
  for (int x = 0, size = SLICE_MBS; x < mb_width; x += size) {
    while (mb_width - x < size) size >>= 1;
    xs[columns] = x;
    sizes[columns++] = size;
    if (columns == 64) return -2;
  }
  uint32_t table_bytes = (uint32_t)(columns * mb_height * 2);
  if (table_bytes > capacity) return -1;
  uint32_t offset = table_bytes;
  int slice = 0;
  double remaining_mbs = (double)mb_width * mb_height;
  double remaining_bits = remaining_mbs * bits_per_mb;
  const uint16_t *planes[3] = {y, cb, cr};
  int widths[3] = {width, width >> 1, width >> 1};
  int last = quant_start;
  for (int row = 0; row < mb_height; row++) {
    for (int c = 0; c < columns; c++) {
      int mbs = sizes[c];
      double fair = (remaining_bits / remaining_mbs) * mbs * BORROW;
      double budget = remaining_bits < fair ? remaining_bits : fair;
      for (int p = 0; p < 3; p++) gather(planes[p], widths[p], height, p == 0, xs[c], row, mbs, blocks[p]);
      Writer writers[3];
      for (int p = 0; p < 3; p++) writers[p].out = scratch[p];
      int counts[3] = {4 * mbs, 2 * mbs, 2 * mbs};
      int index = last < quant_start ? quant_start : last;
      int tried = index;
      if (fits(writers, counts, index, budget)) {
        while (index > quant_start) {
          tried = index - 1;
          if (!fits(writers, counts, index - 1, budget)) break;
          index--;
        }
      } else {
        while (index < QUANTS - 1) {
          tried = ++index;
          if (fits(writers, counts, index, budget)) break;
        }
      }
      if (tried != index) fits(writers, counts, index, budget);
      last = index;
      for (int p = 0; p < 3; p++)
        if (writers[p].length > SCRATCH) return -3;
      uint32_t length = HEADER_BYTES + writers[0].length + writers[1].length + writers[2].length;
      if (offset + length > capacity || length > 0xffff) return -1;
      uint8_t *s = out + offset;
      s[0] = HEADER_BYTES << 3;
      s[1] = STEPS[index];
      s[2] = (uint8_t)(writers[0].length >> 8);
      s[3] = (uint8_t)writers[0].length;
      s[4] = (uint8_t)(writers[1].length >> 8);
      s[5] = (uint8_t)writers[1].length;
      uint32_t at = HEADER_BYTES;
      for (int p = 0; p < 3; p++) {
        copy(s + at, scratch[p], writers[p].length);
        at += writers[p].length;
      }
      out[slice * 2] = (uint8_t)(length >> 8);
      out[slice * 2 + 1] = (uint8_t)length;
      offset += length;
      slice++;
      remaining_bits -= length * 8.0;
      remaining_mbs -= mbs;
    }
  }
  return (int32_t)offset;
}
