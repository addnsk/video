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

export interface ColorParamSpec extends ParamSpecBase {
  readonly type: 'color';
  readonly default: readonly [number, number, number, number];
}

export interface PointsParamSpec extends ParamSpecBase {
  readonly type: 'points';
  readonly default: readonly number[];
  readonly max: number;
  readonly bezier?: boolean;
}

export interface TextParamSpec extends ParamSpecBase {
  readonly type: 'text';
  readonly default: string;
}

export type ParamSpec = ScalarParamSpec | EnumParamSpec | ResourceParamSpec | CurveParamSpec | ColorParamSpec | PointsParamSpec | TextParamSpec;

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

export type NodeCategory = 'composite' | 'transform' | 'blur' | 'generator' | 'mask' | 'color' | 'stylize';

export interface NodeInputSpec {
  readonly name: string;
  readonly label?: string;
}

export interface NodePass {
  readonly glsl: string;
}

export interface NodeDef {
  readonly kind: 'node';
  readonly id: string;
  readonly name: string;
  readonly category: NodeCategory;
  readonly inputs: readonly NodeInputSpec[];
  readonly params: readonly ParamSpec[];
  readonly passes: readonly NodePass[];
  readonly raster?: string;
  readonly temporal?: boolean;
  readonly history?: boolean;
}

export const MAX_RASTER_GLYPHS = 128;

export type EffectDef = FilterDef | TransitionDef | NodeDef;

export const defaultParams = (params: readonly ParamSpec[]): Record<string, ParamValue> =>
  Object.fromEntries(params.map((p) => [p.name, p.default as ParamValue]));
