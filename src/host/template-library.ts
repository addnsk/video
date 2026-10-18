import type { NodeTemplate } from '../core/graph-templates';

const KEY = 'montage.templates';

export interface TemplateStorage {
  read(): string | null;
  write(value: string): void;
}

export const localTemplateStorage: TemplateStorage = {
  read: () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write: (value) => {
    try {
      localStorage.setItem(KEY, value);
    } catch {}
  },
};

export class TemplateLibrary {
  private templates: NodeTemplate[];

  constructor(private storage: TemplateStorage = localTemplateStorage) {
    try {
      const parsed = JSON.parse(storage.read() ?? '[]');
      this.templates = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.templates = [];
    }
  }

  list(): readonly NodeTemplate[] {
    return this.templates;
  }

  get(name: string): NodeTemplate | undefined {
    return this.templates.find((t) => t.name === name);
  }

  save(template: NodeTemplate): void {
    this.templates = [...this.templates.filter((t) => t.name !== template.name), template];
    this.storage.write(JSON.stringify(this.templates));
  }

  remove(name: string): void {
    this.templates = this.templates.filter((t) => t.name !== name);
    this.storage.write(JSON.stringify(this.templates));
  }
}
