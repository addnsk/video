export interface AssetDataSource<T> {
  available(assetId: string): boolean;
  load(assetId: string): Promise<T>;
  dispose?(value: T): void;
}

export class AssetDataCache<T> {
  private entries = new Map<string, { value: T | null }>();

  constructor(
    private source: AssetDataSource<T>,
    private onReady: (assetId: string) => void,
    private capacity = Infinity,
  ) {}

  get(assetId: string): T | null {
    const entry = this.entries.get(assetId);
    if (entry) {
      this.entries.delete(assetId);
      this.entries.set(assetId, entry);
      return entry.value;
    }
    if (!this.source.available(assetId)) return null;
    const pending: { value: T | null } = { value: null };
    this.entries.set(assetId, pending);
    this.source.load(assetId).then(
      (value) => {
        if (this.entries.get(assetId) !== pending) return this.source.dispose?.(value);
        pending.value = value;
        this.evict();
        this.onReady(assetId);
      },
      () => {
        if (this.entries.get(assetId) === pending) this.entries.delete(assetId);
      },
    );
    return null;
  }

  invalidate(assetId: string): void {
    const entry = this.entries.get(assetId);
    if (!entry) return;
    this.entries.delete(assetId);
    if (entry.value !== null) this.source.dispose?.(entry.value);
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.invalidate(id);
  }

  private evict() {
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= this.capacity) return;
      if (entry.value !== null) this.invalidate(id);
    }
  }
}
