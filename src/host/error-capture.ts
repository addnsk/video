import type { EventLog } from '../core/log';

export function captureGlobalErrors(log: EventLog, target: Window = window): () => void {
  const onError = (event: ErrorEvent) => log.error('ui', event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => log.error('ui', event.reason);
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
