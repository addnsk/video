import type { ParamValues } from '../../core/model';
import type { ScalarParamSpec } from '../types';

export interface AudioProcessor {
  process(channels: readonly Float32Array[], params: ParamValues): void;
}

export interface AudioEffectDef {
  readonly kind: 'audio';
  readonly id: string;
  readonly name: string;
  readonly params: readonly ScalarParamSpec[];
  create(sampleRate: number, channels: number): AudioProcessor;
}

export const numberParam = (params: ParamValues, spec: ScalarParamSpec): number => {
  const value = params[spec.name];
  return typeof value === 'number' ? value : Number(spec.default);
};
