import type { Project } from '../model';
import { readEdl, writeEdl } from './edl';
import { exchangeFromProject, type Exchange } from './exchange';
import { readFcpxml, writeFcpxml } from './fcpxml';
import { readOtio, writeOtio } from './otio';

export type InterchangeFormat = 'otio' | 'fcpxml' | 'edl';

export const INTERCHANGE_FORMATS: Record<InterchangeFormat, { extension: string; mime: string }> = {
  otio: { extension: 'otio', mime: 'application/json' },
  fcpxml: { extension: 'fcpxml', mime: 'application/xml' },
  edl: { extension: 'edl', mime: 'text/plain' },
};

export interface InterchangeExportOptions {
  readonly timeline?: string;
  readonly videoTrack?: number;
}

export function exportInterchange(project: Project, format: InterchangeFormat, options: InterchangeExportOptions = {}): string {
  const exchange = exchangeFromProject(project, options.timeline);
  if (format === 'otio') return writeOtio(exchange);
  if (format === 'fcpxml') return writeFcpxml(exchange);
  return writeEdl(exchange, { videoTrack: options.videoTrack });
}

export function detectInterchange(text: string, fileName = ''): InterchangeFormat {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'otio') return 'otio';
  if (ext === 'fcpxml' || ext === 'xml') return 'fcpxml';
  if (ext === 'edl') return 'edl';
  const head = text.trimStart();
  if (head.startsWith('{')) return 'otio';
  if (head.startsWith('<')) return 'fcpxml';
  return 'edl';
}

export interface InterchangeReadOptions {
  readonly fileName?: string;
  readonly format?: InterchangeFormat;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
}

export function readInterchange(text: string, options: InterchangeReadOptions): Exchange {
  const format = options.format ?? detectInterchange(text, options.fileName);
  if (format === 'otio') return readOtio(text);
  if (format === 'fcpxml') return readFcpxml(text);
  const name = options.fileName?.replace(/\.[^.]+$/, '');
  return readEdl(text, { fps: options.fps, width: options.width, height: options.height, ...(name ? { name } : {}) });
}

export { importExchange, exchangeFromProject } from './exchange';
export type { Exchange, ImportResult } from './exchange';
