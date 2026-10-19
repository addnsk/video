const NTSC = [23.976, 29.97, 47.952, 59.94, 119.88];

export const isNtsc = (fps: number) => NTSC.some((r) => Math.abs(r - fps) < 0.01);

export const nominalRate = (fps: number) => Math.round(fps);

export function frameRational(fps: number): { num: number; den: number } {
  if (isNtsc(fps)) return { num: 1001, den: Math.round(fps * 1001 / 1000) * 1000 };
  if (Number.isInteger(fps)) return { num: 1, den: fps };
  return { num: 100, den: Math.round(fps * 100) };
}

export const toFrames = (seconds: number, fps: number) => Math.round(seconds * fps + 1e-6);

export function rationalTime(seconds: number, fps: number): string {
  const { num, den } = frameRational(fps);
  const frames = toFrames(seconds, fps);
  if (frames === 0) return '0s';
  const value = frames * num;
  const g = gcd(Math.abs(value), den);
  return den / g === 1 ? `${value / g}s` : `${value / g}/${den / g}s`;
}

export function parseRationalTime(text: string | undefined): number {
  if (!text) return 0;
  const match = /^(-?\d+(?:\.\d+)?)(?:\/(\d+))?s$/.exec(text.trim());
  if (!match) throw new Error(`Bad time value "${text}"`);
  return Number(match[1]) / (match[2] ? Number(match[2]) : 1);
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function formatTimecode(seconds: number, fps: number): string {
  const rate = nominalRate(fps);
  let frames = toFrames(seconds, fps);
  const sign = frames < 0 ? '-' : '';
  frames = Math.abs(frames);
  const ff = frames % rate;
  const total = Math.floor(frames / rate);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}:${pad(ff)}`;
}

export function parseTimecode(text: string, fps: number): number {
  const match = /^(\d{1,2})[:;.](\d{2})[:;.](\d{2})[:;.](\d{2,3})$/.exec(text.trim());
  if (!match) throw new Error(`Bad timecode "${text}"`);
  const [h, m, s, f] = match.slice(1).map(Number);
  const rate = nominalRate(fps);
  return ((h * 3600 + m * 60 + s) * rate + f) / fps;
}
