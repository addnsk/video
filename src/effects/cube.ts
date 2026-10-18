export interface Lut3D {
  readonly size: number;
  readonly data: Float32Array;
}

export function parseCube(text: string): Lut3D {
  let size = 0;
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1], 10);
      continue;
    }
    if (/^[A-Za-z]/.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 3) values.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size) throw new Error('Not a 3D .cube LUT: LUT_3D_SIZE is missing');
  if (values.length !== size ** 3 * 3) throw new Error(`Corrupted LUT: expected ${size ** 3} entries, got ${values.length / 3}`);
  return { size, data: new Float32Array(values) };
}
