const RESERVED = new Set(
  'attribute const uniform varying layout centroid flat smooth noperspective break continue do for while switch case default if else in out inout float int void bool true false invariant discard return mat2 mat3 mat4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 lowp mediump highp precision sampler2D sampler3D samplerCube struct asm class union enum typedef template this goto inline noinline volatile public static extern external interface long short double half fixed unsigned superp input output hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 sizeof cast namespace using sample filter resource patch subroutine radians degrees sin cos tan asin acos atan sinh cosh tanh pow exp log exp2 log2 sqrt inversesqrt abs sign floor trunc round ceil fract mod min max clamp mix step smoothstep length distance dot cross normalize reflect refract matrixCompMult outerProduct transpose determinant inverse lessThan greaterThan equal not any all texture textureSize texelFetch modf isnan isinf noise'.split(' '),
);

export const isReservedGlslName = (name: string): boolean => RESERVED.has(name) || name.startsWith('gl_') || name.startsWith('u_');

export function reservedNames(names: readonly string[]): string[] {
  return names.filter(isReservedGlslName);
}
