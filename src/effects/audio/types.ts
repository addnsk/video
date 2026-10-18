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
  latency?(sampleRate: number): number;
  tail?(params: ParamValues): number;
}

export const effectLatency = (def: AudioEffectDef | undefined, sampleRate: number): number => def?.latency?.(sampleRate) ?? 0;

export const effectTail = (def: AudioEffectDef | undefined, params: ParamValues): number => def?.tail?.(params) ?? 0;

export const numberParam = (params: ParamValues, spec: ScalarParamSpec): number => {
  const value = params[spec.name];
  return typeof value === 'number' ? value : Number(spec.default);
};
