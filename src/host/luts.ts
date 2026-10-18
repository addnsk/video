import { Emitter } from '../core/emitter';
import { createId } from '../core/ids';
import type { Lut3D } from '../effects/cube';

export interface LutEntry {
  readonly id: string;
  readonly name: string;
  readonly lut: Lut3D;
}

export class LutLibrary extends Emitter<{ added: LutEntry; removed: string }> {
  private entries = new Map<string, LutEntry>();

  add(name: string, lut: Lut3D, id = createId('lut')): LutEntry {
    const entry = { id, name, lut };
    this.entries.set(id, entry);
    this.emit('added', entry);
    return entry;
  }

  get(id: string): LutEntry | undefined {
    return this.entries.get(id);
  }

  all(): LutEntry[] {
    return [...this.entries.values()];
  }

  remove(id: string): void {
    if (this.entries.delete(id)) this.emit('removed', id);
  }
}
