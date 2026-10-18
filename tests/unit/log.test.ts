import { describe, expect, it } from 'vitest';
import { EventLog, describeError, type LogEntry } from '../../src/core/log';

const clock = (start = 0) => {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
};

describe('EventLog', () => {
  it('records entries and notifies', () => {
    const log = new EventLog();
    const seen: string[] = [];
    log.on('entry', (e) => seen.push(e.message));
    log.record('warning', 'media', 'slow decode');
    log.error('engine', new TypeError('bad'));
    expect(log.entries().map((e) => [e.level, e.source, e.message])).toEqual([
      ['warning', 'media', 'slow decode'],
      ['error', 'engine', 'TypeError: bad'],
    ]);
    expect(log.errorCount).toBe(1);
    expect(seen).toEqual(['slow decode', 'TypeError: bad']);
  });

  it('folds repeats inside a short window', () => {
    const c = clock();
    const log = new EventLog(10, null, c.now);
    log.record('error', 'engine', 'boom');
    c.advance(1000);
    log.record('error', 'engine', 'boom');
    c.advance(10_000);
    log.record('error', 'engine', 'boom');
    expect(log.entries().map((e) => e.count)).toEqual([2, 1]);
  });

  it('keeps the newest entries within capacity', () => {
    const log = new EventLog(3);
    for (let i = 0; i < 5; i++) log.record('info', 'ui', `m${i}`);
    expect(log.entries().map((e) => e.message)).toEqual(['m2', 'm3', 'm4']);
  });

  it('loads from and saves to a store, surviving store failures', () => {
    let saved: readonly LogEntry[] = [];
    const initial: LogEntry[] = [{ time: new Date(0).toISOString(), level: 'error', source: 'ui', message: 'old', count: 1 }];
    const log = new EventLog(10, { load: () => initial, save: (e) => (saved = e) });
    log.record('info', 'ui', 'new');
    expect(saved.map((e) => e.message)).toEqual(['old', 'new']);
    const broken = new EventLog(10, { load: () => [], save: () => { throw new Error('quota'); } });
    expect(() => broken.record('info', 'ui', 'x')).not.toThrow();
  });

  it('builds a JSON report and clears', () => {
    const log = new EventLog();
    log.record('error', 'export', 'failed');
    const report = JSON.parse(log.report({ mode: 'worker' }));
    expect(report.context).toEqual({ mode: 'worker' });
    expect(report.entries).toHaveLength(1);
    log.clear();
    expect(log.entries()).toHaveLength(0);
  });

  it('describes any thrown value', () => {
    expect(describeError(new Error('x')).message).toBe('x');
    expect(describeError('text').message).toBe('text');
    expect(describeError({ code: 3 }).message).toBe('{"code":3}');
  });
});
