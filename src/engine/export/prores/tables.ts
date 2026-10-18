export const FRAME_ID = 0x69637066;

export const PROGRESSIVE_SCAN: readonly number[] = [
  0, 1, 8, 9, 2, 3, 10, 11,
  16, 17, 24, 25, 18, 19, 26, 27,
  4, 5, 12, 20, 13, 6, 7, 14,
  21, 28, 29, 22, 15, 23, 30, 31,
  32, 33, 40, 48, 41, 34, 35, 42,
  49, 56, 57, 50, 43, 36, 37, 44,
  51, 58, 59, 52, 45, 38, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
];

export const FIRST_DC_CODEBOOK = 0xb8;
export const DC_CODEBOOKS: readonly number[] = [0x04, 0x28, 0x4d, 0x70];
export const AC_CODEBOOKS: readonly number[] = [0x04, 0x28, 0x4c, 0x05, 0x29, 0x06, 0x0a];
export const RUN_TO_CODEBOOK: readonly number[] = [5, 5, 3, 3, 0, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 2];
export const LEVEL_TO_CODEBOOK: readonly number[] = [0, 6, 3, 5, 0, 1, 1, 1, 1, 2];

export const DEFAULT_QUANT_MATRIX = 4;

export const PRORES_PROFILES = ['proxy', 'lt', 'standard', 'hq'] as const;
export type ProresProfile = (typeof PRORES_PROFILES)[number];

export interface ProfileInfo {
  readonly fourCc: string;
  readonly targetBitrate: number;
  readonly bitsPerMacroblock: number;
  readonly minQuant: number;
}

export const PROFILES: Readonly<Record<ProresProfile, ProfileInfo>> = {
  proxy: { fourCc: 'apco', targetBitrate: 45_000_000, bitsPerMacroblock: 190, minQuant: 4 },
  lt: { fourCc: 'apcs', targetBitrate: 102_000_000, bitsPerMacroblock: 420, minQuant: 1 },
  standard: { fourCc: 'apcn', targetBitrate: 147_000_000, bitsPerMacroblock: 600, minQuant: 1 },
  hq: { fourCc: 'apch', targetBitrate: 220_000_000, bitsPerMacroblock: 900, minQuant: 1 },
};

export const profileForFourCc = (fourCc: string): ProresProfile | null =>
  (Object.entries(PROFILES).find(([, info]) => info.fourCc === fourCc)?.[0] as ProresProfile | undefined) ?? null;

export const QUANT_STEPS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128];
