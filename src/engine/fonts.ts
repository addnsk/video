export interface FontSource {
  readonly family: string;
  readonly weight: number;
  readonly url: string;
  readonly unicodeRange?: string;
}

export const TEXT_FONTS = ['IBM Plex Sans', 'IBM Plex Mono', 'serif', 'sans-serif'] as const;

type FontHost = { fonts: FontFaceSet };

export async function loadFonts(sources: readonly FontSource[]): Promise<void> {
  const host = globalThis as unknown as FontHost;
  if (!host.fonts || typeof FontFace === 'undefined') return;
  await Promise.all(
    sources.map(async (s) => {
      try {
        const face = new FontFace(s.family, `url(${s.url})`, { weight: String(s.weight), unicodeRange: s.unicodeRange });
        host.fonts.add(await face.load());
      } catch {
        return;
      }
    }),
  );
}
