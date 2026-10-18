import { addStill, applyGrade, captureGrade, removeStill } from '../core/grades';
import { createId } from '../core/ids';
import type { Still } from '../core/model';
import { compositionAt, findPlacement } from '../core/timeline';
import type { EditorSession } from './session';

const STILL_HEIGHT = 270;

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export class StillsController {
  private comparing: string | null = null;
  private position = 0.5;

  constructor(private session: EditorSession) {}

  get list(): readonly Still[] {
    return this.session.store.project.stills ?? [];
  }

  get compared(): string | null {
    return this.comparing;
  }

  get comparePosition(): number {
    return this.position;
  }

  private gradeSource(time: number, itemId?: string) {
    const project = this.session.store.project;
    if (itemId) return findPlacement(project, itemId)?.item ?? null;
    const layers = compositionAt(project, time).layers;
    return layers.at(-1)?.base.placement.item ?? null;
  }

  async grab(options: { name?: string; itemId?: string } = {}): Promise<Still> {
    const time = this.session.transport.time;
    const blob = await this.session.engine.remote.grabFrame(time, STILL_HEIGHT);
    if (!blob) throw new Error('Nothing to grab at the playhead');
    const item = this.gradeSource(time, options.itemId);
    const still: Still = {
      id: createId('still'),
      name: options.name ?? `Still ${this.list.length + 1}`,
      time,
      image: await toDataUrl(blob),
      grade: item ? captureGrade(item) : { effects: [], animations: {} },
    };
    this.session.store.dispatch(addStill(still));
    return still;
  }

  remove(id: string): void {
    if (this.comparing === id) void this.compare(null);
    this.session.store.dispatch(removeStill(id));
  }

  applyTo(id: string, itemIds: readonly string[]): void {
    const still = this.list.find((s) => s.id === id);
    if (!still) throw new Error(`No still ${id}`);
    void this.session.store.transaction(() => {
      for (const itemId of itemIds) this.session.store.dispatch(applyGrade(itemId, still.grade));
    });
  }

  async compare(id: string | null, position = this.position): Promise<void> {
    this.position = Math.min(1, Math.max(0, position));
    const still = id ? this.list.find((s) => s.id === id) : null;
    if (id && !still) throw new Error(`No still ${id}`);
    this.comparing = still ? still.id : null;
    if (!still) {
      await this.session.engine.remote.setCompare(null);
      return;
    }
    const bitmap = await createImageBitmap(await (await fetch(still.image)).blob());
    await this.session.engine.remote.setCompare(bitmap, this.position);
  }

  async wipe(position: number): Promise<void> {
    this.position = Math.min(1, Math.max(0, position));
    if (this.comparing) await this.session.engine.remote.setComparePosition(this.position);
  }
}
