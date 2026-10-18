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
import { EditorSession } from './host/session';
import { mountApp } from './ui/app';
import { h } from './ui/dom';

applyLocalePreference();
const root = document.getElementById('app')!;
const preview = h('canvas', { id: 'preview' });
root.append(preview);
const engine = await startEngine(preview);
const session = new EditorSession(engine);
captureGlobalErrors(session.log);
void session.platform();
const persistence = new ProjectPersistence(session);
const app = mountApp(root, preview, session, persistence);
if (await persistence.restore()) {
  app.fit();
  session.transport.seek(0);
}
