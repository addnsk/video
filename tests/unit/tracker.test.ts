import { describe, expect, it } from 'vitest';
import { PointTracker, extractTemplate, matchTemplate, type LumaFrame } from '../../src/engine/tracking/tracker';

const scene = (ox: number, oy: number, width = 160, height = 120): LumaFrame => {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const bx = x - ox;
      const by = y - oy;
      const blob = Math.exp(-((bx - 60) ** 2 + (by - 50) ** 2) / 40) * 200 + Math.exp(-((bx - 66) ** 2 + (by - 44) ** 2) / 10) * 120;
      data[y * width + x] = 20 + blob + ((x * 7 + y * 13) % 5);
    }
  return { width, height, data };
};

describe('template matching', () => {
  it('finds a shifted feature with sub-pixel refinement', () => {
    const template = extractTemplate(scene(0, 0), 60, 50, 15)!;
    const found = matchTemplate(scene(5, -3), template, 60, 50, 8);
    expect(found.x).toBeCloseTo(65, 0);
    expect(found.y).toBeCloseTo(47, 0);
    expect(found.confidence).toBeGreaterThan(0.95);
  });

  it('refuses templates that leave the frame', () => {
    expect(extractTemplate(scene(0, 0), 2, 2, 15)).toBeNull();
  });
});

describe('PointTracker', () => {
  it('follows a moving feature across frames', () => {
    const tracker = new PointTracker({ patch: 15, search: 6 }, 60, 50);
    const path = Array.from({ length: 10 }, (_, i) => tracker.step(scene(i * 3, i * 2)));
    expect(path[9].x).toBeCloseTo(60 + 27, 0);
    expect(path[9].y).toBeCloseTo(50 + 18, 0);
    expect(path.every((p) => p.confidence > 0.8)).toBe(true);
  });
});
