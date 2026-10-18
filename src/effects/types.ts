import type { ParamValue } from '../core/model';

export type ScalarParamType = 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4';
export type ResourceKind = 'lut3d';

export interface ParamSpecBase {
  readonly name: string;
  readonly label?: string;
}

export interface ScalarParamSpec extends ParamSpecBase {
  readonly type: ScalarParamType;
  readonly default: number | boolean | readonly number[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface EnumParamSpec extends ParamSpecBase {
  readonly type: 'enum';
  readonly default: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export interface ResourceParamSpec extends ParamSpecBase {
  readonly type: 'resource';
  readonly resource: ResourceKind;
  readonly default: '';
}

export interface CurveParamSpec extends ParamSpecBase {
  readonly type: 'curve';
  readonly default: readonly number[];
  readonly periodic?: boolean;
}

export type ParamSpec = ScalarParamSpec | EnumParamSpec | ResourceParamSpec | CurveParamSpec;

export interface FilterDef {
  readonly kind: 'filter';
  readonly id: string;
  readonly name: string;
  readonly stage?: number;
  readonly params: readonly ParamSpec[];
  readonly glsl: string;
}

export interface TransitionDef {
  readonly kind: 'transition';
  readonly id: string;
  readonly name: string;
  readonly params: readonly ParamSpec[];
  readonly glsl: string;
}

export type EffectDef = FilterDef | TransitionDef;

export const defaultParams = (params: readonly ParamSpec[]): Record<string, ParamValue> =>
  Object.fromEntries(params.map((p) => [p.name, p.default as ParamValue]));
