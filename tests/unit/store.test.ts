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

describe('store edge cases', () => {
  it('clears redo after a new edit', () => {
    const store = new Store();
    store.dispatch(addAsset(asset('a')), { history: false });
    store.dispatch(insertItem('a', { trackId: 'v1', id: 'x' }));
    store.undo();
    expect(store.canRedo).toBe(true);
    store.dispatch(insertItem('a', { trackId: 'v1', id: 'y' }));
    expect(store.canRedo).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('reset drops history', () => {
    const store = new Store();
    store.dispatch(addAsset(asset('a')));
    store.reset(store.project);
    expect(store.canUndo).toBe(false);
    expect(store.undo()).toBe(false);
  });

  it('ignores no-op operations', () => {
    const store = new Store();
    let changes = 0;
    store.on('change', () => changes++);
    store.dispatch((p) => p);
    expect(changes).toBe(0);
    expect(store.canUndo).toBe(false);
  });

  it('records a transaction as one step, including nested ones', async () => {
    const store = new Store();
    store.dispatch(addAsset(asset('a')), { history: false });
    await store.transaction(async () => {
      store.dispatch(insertItem('a', { trackId: 'v1', id: 'x' }));
      await store.transaction(() => store.dispatch(setVolume('x', 0.5)));
    });
    store.undo();
    expect(store.project.tracks[0].items).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });
});
