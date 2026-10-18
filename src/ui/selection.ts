import { Emitter } from '../core/emitter';
import type { Store } from '../core/store';
import { findPlacement } from '../core/timeline';

export class Selection extends Emitter<{ change: string | null }> {
  private current: string | null = null;

  constructor(store: Store) {
    super();
    store.on('change', ({ project }) => {
      if (this.current && !findPlacement(project, this.current)) this.set(null);
    });
  }

  get id(): string | null {
    return this.current;
  }

  set(id: string | null): void {
    if (id === this.current) return;
    this.current = id;
    this.emit('change', id);
  }
}
