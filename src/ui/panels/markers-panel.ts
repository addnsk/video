import { markerColors, removeMarker, updateMarker } from '../../core/editing';
import type { Marker } from '../../core/model';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { formatTimecode, h } from '../dom';
import { MARKER_PAINT } from '../timeline-view';
import { Panel } from './panel';

export class MarkersPanel extends Panel {
  constructor(private session: EditorSession) {
    super('markers', t('markersTitle'));
    session.store.on('change', ({ project, previous }) => {
      if (project.markers !== previous.markers) this.render();
    });
    this.render();
  }

  private update(id: string, patch: Partial<Omit<Marker, 'id'>>) {
    this.session.store.dispatch(updateMarker(id, patch), { coalesce: `marker:${id}` });
  }

  private render() {
    const markers = this.session.store.project.markers ?? [];
    if (!markers.length) {
      this.body.replaceChildren(h('p', { class: 'hint' }, t('markersEmpty')));
      return;
    }
    const fps = this.session.store.project.settings?.fps ?? 25;
    this.body.replaceChildren(
      ...markers.map((marker) => {
        const color = h('select', { 'aria-label': t('markerColor'), onChange: (e: Event) => this.update(marker.id, { color: (e.target as HTMLSelectElement).value }) },
          ...markerColors().map((c) => h('option', { value: c, selected: c === marker.color }, c)),
        );
        return h('div', { class: 'marker-row', 'data-marker': marker.id },
          h('span', { class: 'swatch', style: `background:${MARKER_PAINT[marker.color]}` }),
          h('button', { class: 'btn small tc-link', onClick: () => this.session.transport.seek(marker.time) }, formatTimecode(marker.time, fps)),
          h('input', { type: 'text', value: marker.name, placeholder: t('markerName'), 'aria-label': t('markerName'), onChange: (e: Event) => this.update(marker.id, { name: (e.target as HTMLInputElement).value }) }),
          color,
          h('input', { type: 'text', class: 'note', value: marker.note, placeholder: t('markerNote'), 'aria-label': t('markerNote'), onChange: (e: Event) => this.update(marker.id, { note: (e.target as HTMLInputElement).value }) }),
          h('button', { class: 'btn small', 'aria-label': t('markerRemove'), onClick: () => this.session.store.dispatch(removeMarker(marker.id)) }, '×'),
        );
      }),
    );
  }
}
