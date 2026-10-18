import { execFileSync } from 'node:child_process';

const KR = 0.2126;
const KB = 0.0722;

export function decodeFrame(path, frame, width, height) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv422p10le', '-'], { maxBuffer: 512 * 1024 * 1024 });
  const chroma = width / 2;
  const yAt = (x, y) => raw.readUInt16LE((y * width + x) * 2);
  const cAt = (plane, x, y) => raw.readUInt16LE((width * height + plane * chroma * height + y * chroma + Math.min(chroma - 1, x)) * 2);
  return (x, y) => {
    const Y = (yAt(x, y) - 64) / 876;
    const cx = x / 2;
    const lo = Math.floor(cx);
    const f = cx - lo;
    const interp = (plane) => ((cAt(plane, lo, y) * (1 - f) + cAt(plane, lo + 1, y) * f) - 512) / 896;
    const Cb = interp(0);
    const Cr = interp(1);
    const r = Y + 2 * (1 - KR) * Cr;
    const b = Y + 2 * (1 - KB) * Cb;
    const g = (Y - KR * r - KB * b) / (1 - KR - KB);
    return [r, g, b].map((v) => Math.min(1, Math.max(0, v)));
  };
}
