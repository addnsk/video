export const SPACES = {
  slog3: (x) => (x >= 171.2102946929 / 1023 ? 10 ** ((x * 1023 - 420) / 261.5) * 0.19 - 0.01 : ((x * 1023 - 95) * 0.01125) / (171.2102946929 - 95)),
  logc3: (x) => (x > 5.367655 * 0.010591 + 0.092809 ? (10 ** ((x - 0.385537) / 0.24719) - 0.052272) / 5.555556 : (x - 0.092809) / 5.367655),
  vlog: (x) => (x < 0.181 ? (x - 0.125) / 5.6 : 10 ** ((x - 0.598206) / 0.241514) - 0.00873),
  clog3: (x) =>
    0.9 *
    (x < 0.097465473
      ? -(10 ** ((0.12783901 - x) / 0.36726845) - 1) / 14.98325
      : x <= 0.15277891
        ? (x - 0.12512219) / 1.9754798
        : (10 ** ((x - 0.12240537) / 0.36726845) - 1) / 14.98325),
  bmdFilmGen5: (x) => (x < 8.283605932402494 * 0.005 + 0.09246575342465753 ? (x - 0.09246575342465753) / 8.283605932402494 : Math.exp((x - 0.5300133392291939) / 0.08692876065491224) - 0.005494072432257808),
  rec2020Hlg: (x) => {
    const a = 0.17883277;
    const b = 1 - 4 * a;
    const c = 0.5 - a * Math.log(4 * a);
    return (x <= 0.5 ? (x * x) / 3 : (Math.exp((x - c) / a) + b) / 12) / 0.2627;
  },
  rec2020Pq: (x) => {
    const m1 = 2610 / 16384;
    const m2 = (2523 / 4096) * 128;
    const c1 = 3424 / 4096;
    const c2 = (2413 / 4096) * 32;
    const c3 = (2392 / 4096) * 32;
    const p = x ** (1 / m2);
    return ((Math.max(p - c1, 0) / (c2 - c3 * p)) ** (1 / m1) * 10000) / 203;
  },
  linear: (x) => x,
};

export const MIDDLE_GRAY_CODES = { slog3: 420 / 1023, logc3: 0.391007, vlog: 0.423, clog3: 0.343 };

export const rec709Encode = (l) => (l < 0.018 ? 4.5 * Math.max(0, l) : 1.099 * l ** 0.45 - 0.099);
export const rec709Decode = (v) => (v < 0.081 ? v / 4.5 : ((v + 0.099) / 1.099) ** (1 / 0.45));

export const acescctEncode = (l) => (l <= 0.0078125 ? 10.5402377416545 * l + 0.0729055341958355 : (Math.log2(l) + 9.72) / 17.52);
export const acescctDecode = (c) => (c <= 0.155251141552511 ? (c - 0.0729055341958355) / 10.5402377416545 : 2 ** (c * 17.52 - 9.72));

export const REC709_TO_AP1 = [
  [0.613097, 0.339523, 0.047379],
  [0.070194, 0.916354, 0.013452],
  [0.020616, 0.10957, 0.869815],
];

export const mul = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

export function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const ACES_INPUT = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const ACES_OUTPUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];
const rrt = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);

export function acesOdt(cct) {
  const lin709 = mul(invert3(REC709_TO_AP1), cct.map(acescctDecode));
  const fitted = mul(ACES_OUTPUT, mul(ACES_INPUT, lin709).map(rrt));
  return fitted.map((v) => rec709Encode(Math.min(1, Math.max(0, v))));
}

export const displayFromScene = (l) => rec709Encode(Math.max(0, l) / (Math.max(0, l) + 0.82));
