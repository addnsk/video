// Параметры покраски одного клипа. Все значения нейтральны по умолчанию.

export type InputTransform = 'none' | 'bmdFilmGen5';

export interface Wheel {
  x: number; // смещение оттенка, единичный круг
  y: number;
  master: number; // яркость колеса, -1..1
}

export interface Lut {
  name: string;
  size: number;
  data: Float32Array; // RGB, красный меняется быстрее всего (порядок .cube)
}

export interface Grade {
  input: InputTransform;
  exposure: number; // стопы
  temperature: number; // -1..1
  tint: number; // -1..1
  contrast: number; // 1 = нейтрально
  pivot: number;
  saturation: number; // 1 = нейтрально
  lift: Wheel;
  gamma: Wheel;
  gain: Wheel;
  lut: Lut | null;
  lutMix: number;
}

const wheel = (): Wheel => ({ x: 0, y: 0, master: 0 });

export const defaultGrade = (): Grade => ({
  input: 'none',
  exposure: 0,
  temperature: 0,
  tint: 0,
  contrast: 1,
  pivot: 0.435,
  saturation: 1,
  lift: wheel(),
  gamma: wheel(),
  gain: wheel(),
  lut: null,
  lutMix: 1,
});

export const cloneGrade = (g: Grade): Grade => ({
  ...g,
  lift: { ...g.lift },
  gamma: { ...g.gamma },
  gain: { ...g.gain },
});

/** Смещение колеса в RGB с нулевой суммой: оттенок меняется, яркость нет. */
export function wheelToRgb(w: Wheel): [number, number, number] {
  const r = Math.hypot(w.x, w.y);
  if (r === 0) return [0, 0, 0];
  const a = Math.atan2(-w.y, w.x); // 0 = красный справа, против часовой
  const rgb = [0, 2, 4].map((k) => Math.cos(a - (k * Math.PI) / 3));
  return rgb.map((v) => v * r) as [number, number, number];
}

export function parseCube(text: string, name: string): Lut {
  let size = 0;
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1], 10);
      continue;
    }
    if (/^[A-Za-z]/.test(line)) continue; // TITLE, DOMAIN_MIN и прочее
    const parts = line.split(/\s+/);
    if (parts.length >= 3) values.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size) throw new Error('В файле нет LUT_3D_SIZE. Поддерживаются только 3D LUT в формате .cube.');
  if (values.length !== size * size * size * 3) {
    throw new Error(`LUT повреждён: ожидалось ${size ** 3} строк, найдено ${values.length / 3}.`);
  }
  return { name, size, data: new Float32Array(values) };
}
