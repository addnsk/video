import type { TrackApply } from '../core/tracking';
import { findPlacement } from '../core/timeline';
import { trackPoint } from '../host/point-tracking';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { toast } from './components/toast';
import type { PointPicker } from './point-picker';

export async function trackFromViewer(session: EditorSession, picker: PointPicker, itemId: string, apply: TrackApply): Promise<void> {
  const point = await picker.pick();
  const placement = findPlacement(session.store.project, itemId);
  if (!point || !placement) return;
  toast(t('trackRunning'));
  try {
    const path = await trackPoint(session, itemId, { ...point, from: Math.max(0, session.transport.time - placement.start), apply });
    toast(t('trackDone', { count: path.length }));
  } catch (error) {
    toast((error as Error).message, 'error');
  }
}
