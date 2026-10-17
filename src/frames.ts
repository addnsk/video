import type { VideoSample } from 'mediabunny';
import type { Project, Frame, Clip } from './project';
import type { Renderer } from './renderer';

/** Последовательное чтение кадров одного клипа: для воспроизведения и экспорта. */
class ClipReader {
  private gen: AsyncGenerator<VideoSample, void, unknown>;
  private cur: VideoSample | null = null;
  private next: VideoSample | null = null;
  private done = false;
  private started = false;
  uploadedTimestamp = NaN;

  constructor(
    readonly clip: Clip,
    project: Project,
    readonly from: number,
  ) {
    const asset = project.assets.get(clip.assetId)!;
    this.gen = asset.frames.samples(from, clip.out);
  }

  /** Кадр, который показывается в момент src (время в исходнике). */
  async at(src: number): Promise<VideoSample | null> {
    if (!this.started) {
      this.started = true;
      await this.pull();
    }
    while (!this.done && (this.cur === null || (this.next && this.next.timestamp <= src + 1e-4))) {
      if (this.next) {
        this.cur?.close();
        this.cur = this.next;
        this.next = null;
      }
      await this.pull();
      if (!this.next) break;
    }
    return this.cur ?? this.next;
  }

  private async pull() {
    const r = await this.gen.next();
    if (r.done) this.done = true;
    else this.next = r.value;
  }

  close() {
    void this.gen.return();
    this.cur?.close();
    this.next?.close();
    this.cur = this.next = null;
  }
}

/**
 * Собирает кадр таймлайна в момент t: читает нужные клипы, грузит их в слоты
 * рендера и рисует. Держит открытыми читателей только видимых клипов.
 */
export class FrameFetcher {
  private readers = new Map<string, ClipReader>();

  constructor(
    private project: Project,
    private renderer: Renderer,
  ) {}

  private reader(clip: Clip, src: number) {
    let r = this.readers.get(clip.id);
    // Новый читатель, если клип изменился или нужно назад.
    if (r && (r.clip !== clip || src < r.from - 1e-4 || r.clip.out !== clip.out)) {
      r.close();
      r = undefined;
    }
    if (!r) {
      r = new ClipReader(clip, this.project, src);
      this.readers.set(clip.id, r);
    }
    return r;
  }

  /** Готовит кадр в момент t. Возвращает false, если на этом месте пусто. */
  async load(frame: Frame, t: number) {
    const layers = [frame.layer, frame.next?.layer].filter((l) => !!l);
    const keep = new Set(layers.map((l) => l.clip.id));
    for (const [id, r] of this.readers) {
      if (!keep.has(id)) {
        r.close();
        this.readers.delete(id);
      }
    }
    const samples = await Promise.all(layers.map((l) => this.reader(l.clip, l.clip.in + (t - l.start)).at(l.clip.in + (t - l.start))));
    samples.forEach((sample, slot) => {
      if (!sample) return;
      const r = this.readers.get(layers[slot].clip.id)!;
      if (r.uploadedTimestamp === sample.timestamp && slot === 0) return;
      this.renderer.upload(slot, sample.toCanvasImageSource(), sample.displayWidth, sample.displayHeight);
      r.uploadedTimestamp = slot === 0 ? sample.timestamp : NaN;
    });
  }

  close() {
    for (const r of this.readers.values()) r.close();
    this.readers.clear();
  }
}

/** Рисует уже загруженный кадр с покраской и переходом. */
export function drawFrame(renderer: Renderer, frame: Frame | null, bypass = false) {
  if (!frame) return renderer.draw(null);
  const n = frame.next;
  renderer.draw(
    { grade: frame.layer.clip.grade },
    n && { grade: n.layer.clip.grade, transition: n.transition, progress: n.progress },
    bypass,
  );
}

/** Одиночный кадр для перемотки: без последовательного чтения. */
export async function loadStill(project: Project, renderer: Renderer, frame: Frame, t: number, isStale: () => boolean) {
  const layers = [frame.layer, frame.next?.layer].filter((l) => !!l);
  const samples = await Promise.all(
    layers.map((l) => project.assets.get(l.clip.assetId)!.frames.getSample(l.clip.in + (t - l.start))),
  );
  if (isStale()) {
    for (const s of samples) s?.close();
    return false;
  }
  samples.forEach((s, slot) => {
    if (!s) return;
    renderer.upload(slot, s.toCanvasImageSource(), s.displayWidth, s.displayHeight);
    s.close();
  });
  return true;
}
