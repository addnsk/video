import { runScript, type MontageApi } from '../../api/montage';
import { t } from '../../i18n';
import { h } from '../dom';
import { EXAMPLES } from '../script-examples';
import { Panel } from './panel';

export class ScriptPanel extends Panel {
  private code: HTMLTextAreaElement;
  private output = h('pre', { class: 'log', hidden: true });
  private run: HTMLButtonElement;

  constructor(private api: MontageApi) {
    super('script', t('scriptTitle'));
    const examples = h('select', { id: 'script-example', 'aria-label': t('scriptExamples') },
      h('option', { value: '' }, t('scriptExamples')),
      ...EXAMPLES.map((ex, i) => h('option', { value: String(i) }, ex.name)));
    examples.addEventListener('change', () => {
      const ex = EXAMPLES[+examples.value];
      if (ex) this.code.value = ex.code;
      examples.value = '';
    });
    this.code = h('textarea', { id: 'script-code', spellcheck: false, rows: 10, 'aria-label': t('scriptTitle') });
    this.code.value = EXAMPLES[0].code;
    this.code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.execute();
      }
    });
    this.run = h('button', { class: 'btn primary', id: 'script-run', onClick: () => void this.execute() }, t('scriptRun'));
    this.body.append(examples, this.code, h('div', { class: 'row' }, this.run), this.output);
    this.run.title = t('scriptHint');
  }

  load(code: string): void {
    this.code.value = code;
    this.code.focus();
  }

  private log = (...args: unknown[]) => {
    this.output.textContent += `${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  };

  private async execute() {
    this.output.hidden = false;
    this.output.textContent = '';
    this.run.disabled = true;
    try {
      const result = await runScript(this.code.value, this.api, this.log);
      if (result !== undefined) this.log('→', result);
      if (!this.output.textContent) this.log(t('scriptDone'));
    } catch (e) {
      this.log(t('scriptError', { message: (e as Error).message }));
    } finally {
      this.run.disabled = false;
    }
  }
}
