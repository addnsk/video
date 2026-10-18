import { describe, expect, it } from 'vitest';
import { addAsset, insertItem, setVolume } from '../../src/core/operations';
import { Store } from '../../src/core/store';
import { asset } from './fixtures';

describe('store history', () => {
  it('undoes and redoes', () => {
    const store = new Store();
    store.dispatch(addAsset(asset('a')), { history: false });
    store.dispatch(insertItem('a', { trackId: 'v1', id: 'x' }));
    expect(store.project.tracks[0].items).toHaveLength(1);
    store.undo();
    expect(store.project.tracks[0].items).toHaveLength(0);
    store.redo();
    expect(store.project.tracks[0].items).toHaveLength(1);
  });

  it('coalesces rapid edits with the same key', () => {
    const store = new Store();
    store.dispatch(addAsset(asset('a')), { history: false });
    store.dispatch(insertItem('a', { trackId: 'v1', id: 'x' }));
    for (let v = 0; v < 10; v++) store.dispatch(setVolume('x', v / 10), { coalesce: 'volume' });
    store.undo();
    expect(store.project.tracks[0].items[0].volume).toBe(1);
    store.undo();
    expect(store.project.tracks[0].items).toHaveLength(0);
  });

  it('records a transaction as one step', async () => {
    const store = new Store();
    store.dispatch(addAsset(asset('a')), { history: false });
    await store.transaction(() => {
      store.dispatch(insertItem('a', { trackId: 'v1' }));
      store.dispatch(insertItem('a', { trackId: 'v1' }));
    });
    expect(store.project.tracks[0].items).toHaveLength(2);
    store.undo();
    expect(store.project.tracks[0].items).toHaveLength(0);
  });
});
