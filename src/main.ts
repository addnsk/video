import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/style.css';
import { captureGlobalErrors } from './host/error-capture';
import { applyLocalePreference } from './host/locale-preference';
import { startEngine } from './host/engine-client';
import { ProjectPersistence } from './host/persistence/project-persistence';
import { RemoteStorage } from './host/remote/remote-storage';
import { EditorSession } from './host/session';
import { mountApp } from './ui/app';
import { h } from './ui/dom';

applyLocalePreference();
const root = document.getElementById('app')!;
const preview = h('canvas', { id: 'preview' });
root.append(preview);
const engine = await startEngine(preview);
const session = new EditorSession(engine);
const sourcePreview = engine.budget.deviceClass === 'desktop' ? h('canvas', { id: 'source-preview' }) : null;
if (sourcePreview) {
  root.append(sourcePreview);
  session.attachSourceEngine(await startEngine(sourcePreview, 'source'));
}
captureGlobalErrors(session.log);
void session.platform();
const persistence = new ProjectPersistence(session);
const remote = new RemoteStorage(session, persistence);
const app = mountApp(root, preview, session, persistence, sourcePreview, remote);
if (await persistence.restore()) {
  app.fit();
  session.transport.seek(0);
}
void remote.restore();
