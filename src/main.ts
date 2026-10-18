import './ui/style.css';
import { startEngine } from './host/engine-client';
import { EditorSession } from './host/session';
import { mountApp } from './ui/app';
import { h } from './ui/dom';

const root = document.getElementById('app')!;
const preview = h('canvas', { id: 'preview' });
root.append(preview);
const engine = await startEngine(preview);
mountApp(root, preview, new EditorSession(engine));
