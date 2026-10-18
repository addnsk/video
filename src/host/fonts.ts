import sansLatin400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url';
import sansLatin700 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2?url';
import sansCyrillic400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-cyrillic-400-normal.woff2?url';
import sansCyrillic700 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-cyrillic-700-normal.woff2?url';
import monoLatin400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url';
import monoCyrillic400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-400-normal.woff2?url';
import type { FontSource } from '../engine/fonts';

const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const CYRILLIC = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';

const absolute = (url: string) => new URL(url, document.baseURI).href;

export const fontSources = (): FontSource[] => [
  { family: 'IBM Plex Sans', weight: 400, url: absolute(sansLatin400), unicodeRange: LATIN },
  { family: 'IBM Plex Sans', weight: 700, url: absolute(sansLatin700), unicodeRange: LATIN },
  { family: 'IBM Plex Sans', weight: 400, url: absolute(sansCyrillic400), unicodeRange: CYRILLIC },
  { family: 'IBM Plex Sans', weight: 700, url: absolute(sansCyrillic700), unicodeRange: CYRILLIC },
  { family: 'IBM Plex Mono', weight: 400, url: absolute(monoLatin400), unicodeRange: LATIN },
  { family: 'IBM Plex Mono', weight: 400, url: absolute(monoCyrillic400), unicodeRange: CYRILLIC },
];
