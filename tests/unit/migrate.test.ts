import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/core/migrate';
import type { Project } from '../../src/core/model';

const full: Project = {
  version: 2,
  settings: { width: 1920, height: 1080, fps: 25, sampleRate: 48000, colorScience: 'aces' },
  assets: {
    a: { id: 'a', name: 'a.mov', size: 1, lastModified: 1, codec: 'ProRes', width: 1920, height: 1080, fps: 25, start: 0, end: 4, hasVideo: true, hasAudio: true, sampleRate: 48000, channels: 2, colorSpace: 'slog3' },
  },
  tracks: [
    {
      id: 'v1',
      kind: 'video',
      magnetic: true,
      muted: false,
      items: [
        {
          id: 'i1',
          kind: 'media',
          start: 0,
          source: { assetId: 'a', in: 0, out: 4 },
          speed: 1.5,
          effects: [{ id: 'fx1', type: 'blur', enabled: true, params: { radius: 3 } }],
          transitionIn: null,
          volume: 0.8,
          opacity: 0.9,
          transform: { x: 0.1, y: 0, scale: 1, rotation: 5 },
          animations: { 'node.fx1.radius': [{ t: 0, v: 1, ease: 'out' }] },
          presets: { in: 'fade' },
          graph: { links: [{ from: 'source', to: 'fx1', input: 'source' }, { from: 'fx1', to: 'output', input: 'input' }], positions: { fx1: [10, 20] } },
          gradeVersions: { A: { effects: [], animations: {} } },
          gradeVersion: 'A',
        },
      ],
    },
    { id: 'v2', kind: 'video', magnetic: false, muted: true, items: [] },
    { id: 'a1', kind: 'audio', magnetic: false, muted: false, items: [] },
  ],
  stills: [{ id: 's1', name: 'Still 1', time: 1, image: 'data:image/jpeg;base64,', grade: { effects: [], animations: {} } }],
};

describe('migrateProject', () => {
  it('keeps every field of a current project', () => {
    expect(migrateProject(JSON.parse(JSON.stringify(full)))).toEqual(full);
  });
});
