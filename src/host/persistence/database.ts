export interface StoreSchema {
  readonly name: string;
  readonly keyPath: string;
}

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export class Database {
  private connection: Promise<IDBDatabase>;

  constructor(name: string, version: number, stores: readonly StoreSchema[]) {
    this.connection = new Promise((resolve, reject) => {
      const open = indexedDB.open(name, version);
      open.onupgradeneeded = () => {
        for (const store of stores)
          if (!open.result.objectStoreNames.contains(store.name)) open.result.createObjectStore(store.name, { keyPath: store.keyPath });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await this.connection;
    return request(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
  }

  async all<T>(store: string): Promise<T[]> {
    const db = await this.connection;
    return request(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
  }

  async put<T>(store: string, value: T): Promise<void> {
    const db = await this.connection;
    await request(db.transaction(store, 'readwrite').objectStore(store).put(value));
  }

  async delete(store: string, key: IDBValidKey): Promise<void> {
    const db = await this.connection;
    await request(db.transaction(store, 'readwrite').objectStore(store).delete(key));
  }
}
