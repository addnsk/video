import type { AssetMeta } from '../../core/model';
import { insertItem } from '../../core/operations';
import { canNest, timelineList } from '../../core/timelines';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { dragSource } from '../components/drag-source';
import { formatDuration, h } from '../dom';
import type { DropTarget } from '../drop-target';
import { Panel } from './panel';

export class MediaPanel extends Panel {
  constructor(
    private session: EditorSession,
    private dropTarget: DropTarget,
    private openSource: (assetId: string) => void,
    private insertTimeline: (timelineId: string) => void,
  ) {
    super('media', t('mediaTitle'));
    session.store.on('change', ({ project, previous }) => {
      if (project.assets !== previous.assets || project.timeline !== previous.timeline || project.timelines !== previous.timelines) this.render();
    });
    session.on('proxy', () => this.render());
    this.render();
  }

  private proxyLabel(asset: AssetMeta): string {
    const state = this.session.proxies.get(asset.id);
    if (!state) return '';
    if (state.state === 'building') return t('proxyBuilding', { percent: Math.round(state.fraction * 100) });
    return t(({ queued: 'proxyQueued', ready: 'proxyReady', failed: 'proxyFailed', building: 'proxyBuilding' } as const)[state.state]);
  }

  private render() {
    const project = this.session.store.project;
    const assets = Object.values(project.assets).filter((a) => !a.timeline);
    const timelines = timelineList(project).filter((x) => !x.active && canNest(project, x.id));
    if (!assets.length) {
      this.body.replaceChildren(h('p', { class: 'hint' }, t('mediaEmpty')));
      return;
    }
    const timelineRows = timelines.length
      ? [
          h('h3', { class: 'sub' }, t('mediaTimelines')),
          ...timelines.map((x) =>
            h('div', { class: 'media-item', 'data-timeline': x.id },
              h('b', {}, x.name),
              h('div', { class: 'row' }, h('button', { class: 'btn', 'data-insert-timeline': x.id, onClick: () => this.insertTimeline(x.id) }, t('timelineInsert'))),
            ),
          ),
        ]
      : [];
    this.body.replaceChildren(
      ...timelineRows,
      ...assets.map((asset) => {
        const proxy = this.proxyLabel(asset);
        const details = asset.hasVideo
          ? `${asset.codec} · ${asset.width}×${asset.height} · ${+asset.fps.toFixed(3)} ${t('fps')} · ${formatDuration(asset.end - asset.start)}`
          : `${asset.codec} · ${asset.sampleRate / 1000} kHz · ${formatDuration(asset.end - asset.start)}`;
        const audioTrack = this.session.store.project.tracks.find((tr) => tr.kind === 'audio');
        const actions = h('div', { class: 'row' },
          h('button', { class: 'btn', 'data-open-source': asset.id, onClick: () => this.openSource(asset.id) }, t('openInViewer')),
          asset.hasVideo && h('button', { class: 'btn', onClick: () => this.session.store.dispatch(insertItem(asset.id, { trackId: this.session.videoTrackId })) }, t('addToTimeline')),
          asset.hasAudio && audioTrack && h('button', {
            class: 'btn',
            onClick: () => this.session.store.dispatch(insertItem(asset.id, { trackId: audioTrack.id, start: this.session.transport.time })),
          }, t('addAudio')),
          asset.hasVideo && !this.session.proxies.has(asset.id) && h('button', { class: 'btn', onClick: () => this.session.requestProxy(asset.id) }, t('makeProxy')),
        );
        const grip = h('span', { class: 'grip', role: 'button', 'aria-label': t('dragToTimeline'), title: t('dragToTimeline') }, '⠿');
        const element = h('div', { class: 'media-item', 'data-asset': asset.id },
          h('b', { title: asset.name }, asset.name),
          grip,
          h('small', {}, details),
          proxy && h('small', { class: 'proxy' }, proxy),
          actions,
        );
        element.addEventListener('dblclick', () => this.openSource(asset.id));
        dragSource(element, grip, {
          label: () => asset.name,
          move: (point) => this.dropTarget.hover(point, asset.id),
          drop: (point) => void this.dropTarget.drop(point, asset.id),
          cancel: () => this.dropTarget.leave(),
        });
        return element;
      }),
    );
  }
}
