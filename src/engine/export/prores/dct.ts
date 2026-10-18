const N = 8;
const COEFFICIENT_SCALE = 4;

export const forwardDctBasis = (() => {
  const m = new Float64Array(N * N);
  for (let k = 0; k < N; k++) {
    const c = k === 0 ? Math.SQRT1_2 : 1;
    for (let n = 0; n < N; n++) m[k * N + n] = 0.5 * c * Math.cos(((2 * n + 1) * k * Math.PI) / 16);
  }
  return m;
})();

const temp = new Float64Array(64);

export function forwardDct(input: Float64Array, output: Int32Array, offset: number): void {
  for (let y = 0; y < N; y++) {
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) sum += forwardDctBasis[k * N + n] * input[y * N + n];
      temp[y * N + k] = sum;
    }
  }
  for (let x = 0; x < N; x++) {
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) sum += forwardDctBasis[k * N + n] * temp[n * N + x];
      output[offset + k * N + x] = Math.round(sum * COEFFICIENT_SCALE);
    }
  }
}
