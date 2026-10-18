import type { Project } from '../../core/model';
import type { EffectDef } from '../../effects/types';

export interface StoredLut {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly data: readonly number[] | Float32Array;
}

export interface ProjectDocument {
  readonly format: 'montage-project';
  readonly version: 1;
  readonly savedAt: string;
  readonly project: Project;
  readonly luts: readonly StoredLut[];
  readonly effects: readonly EffectDef[];
}

export function isProjectDocument(value: unknown): value is ProjectDocument {
  const doc = value as ProjectDocument;
  return !!doc && doc.format === 'montage-project' && doc.version === 1 && Array.isArray(doc.project?.tracks);
}
