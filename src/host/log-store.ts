import type { LogEntry, LogStore } from '../core/log';

export function localLogStore(key: string, storage: () => Storage | null = () => globalThis.localStorage ?? null): LogStore {
  return {
    load() {
      try {
        const raw = storage()?.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as LogEntry[]) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    save(entries) {
      try {
        storage()?.setItem(key, JSON.stringify(entries.slice(-100)));
      } catch {}
    },
  };
}
