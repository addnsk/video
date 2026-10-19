import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { MontageApi } from '../../api/montage';
import type { Project } from '../../core/model';
import type { EditorSession } from '../../host/session';

export interface Services {
  readonly session: EditorSession;
  readonly api: MontageApi;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('Montage services are missing');
  return services;
}

interface Subscribable {
  on(event: never, listener: () => void): () => void;
}

export function useEmitterValue<T>(emitter: Subscribable, events: readonly string[], read: () => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const last = useRef<{ value: T } | null>(null);
  const snapshot = () => {
    const next = read();
    if (last.current && equal(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  };
  const subscribe = (notify: () => void) => {
    const offs = events.map((e) => (emitter.on as (event: string, listener: () => void) => () => void)(e, notify));
    return () => offs.forEach((off) => off());
  };
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useProject<T>(select: (project: Project) => T, equal?: (a: T, b: T) => boolean): T {
  const { session } = useServices();
  return useEmitterValue(session.store, ['change'], () => select(session.store.project), equal);
}

export function usePlayhead(): number {
  const { session } = useServices();
  return useEmitterValue(session.transport, ['time'], () => session.transport.time);
}

export function usePlaying(): boolean {
  const { session } = useServices();
  return useEmitterValue(session.transport, ['state'], () => session.transport.playing);
}

export const shallowEqual = <T>(a: T, b: T): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a as object);
  if (ka.length !== Object.keys(b as object).length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};
