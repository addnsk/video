import { Editor, fixture } from '../harness.mjs';

const setRange = (editor, selector, value) =>
  editor.page.$eval(selector, (el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);

export default {
  name: 'ui-interactions',
  tags: ['edit', 'nodes'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    const { page } = editor;
    await editor.import([fixture('gray.mov'), fixture('moving.mov')]);
    const dialogs = [];
    page.on('dialog', (d) => d.accept(dialogs.shift() ?? ''));
    const ports = async () => JSON.parse((await page.getAttribute('#node-canvas', 'data-ports')) ?? '{}');
    const selectNode = async (id) => {
      let p = await ports();
      for (let i = 0; i < 25 && !p[id]; i++) {
        await editor.settle(200);
        p = await ports();
      }
      const box = await page.locator('#node-canvas').boundingBox();
      await page.mouse.click(box.x + p[id].center[0], box.y + p[id].center[1]);
    };
    const nodeParams = (id) => editor.run((id) => montage.graph.get(0).nodes.find((n) => n.id === id)?.params, id);

    const mask = await editor.run(() => {
      montage.select(0);
      const id = montage.graph.add(0, 'bezier-mask', { feather: 0 });
      return id;
    });
    await page.click('#view-nodes');
    await selectNode(mask);
    await editor.until(() => getComputedStyle(document.querySelector('#mask-overlay')).display !== 'none');
    const handles = await page.locator('#mask-overlay .mask-handle').count();
    checks.check(handles === 8, `a selected Bezier mask shows in and out handles on the viewer (${handles})`);

    const drag = async (locator, dx, dy, modifiers = []) => {
      const b = await locator.boundingBox();
      for (const m of modifiers) await page.keyboard.down(m);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 6 });
      await page.mouse.up();
      for (const m of modifiers) await page.keyboard.up(m);
    };
    const out = page.locator('#mask-overlay .mask-handle[data-part="out"][data-index="0"]');
    await drag(out, 40, 20);
    let points = (await nodeParams(mask)).points;
    checks.check(Math.abs(points[4] + points[2]) < 1e-6 && Math.abs(points[5] + points[3]) < 1e-6 && Math.abs(points[4] - 0.1) > 0.01, `dragging an out handle mirrors the in handle (${points.slice(2, 6).map((v) => v.toFixed(3))})`);
    await drag(page.locator('#mask-overlay .mask-handle[data-part="in"][data-index="1"]'), -30, 30, ['Alt']);
    points = (await nodeParams(mask)).points;
    checks.check(Math.abs(points[8] + points[10]) > 0.01, `Alt-drag breaks the handle symmetry (${points.slice(8, 12).map((v) => v.toFixed(3))})`);
    await drag(page.locator('#mask-overlay .mask-point').nth(2), 30, 0);
    const before = points;
    points = (await nodeParams(mask)).points;
    checks.check(points[12] > before[12] + 0.01 && points[14] === before[14], `dragging an anchor moves the vertex and keeps its handles (${before[12].toFixed(3)} → ${points[12].toFixed(3)})`);
    await page.locator('#mask-overlay .mask-add').first().click();
    points = (await nodeParams(mask)).points;
    checks.check(points.length === 30, `clicking an edge inserts a vertex with handles (${points.length / 6} vertices)`);
    await page.locator('#mask-overlay .mask-point').nth(1).dblclick();
    points = (await nodeParams(mask)).points;
    checks.check(points.length === 24, `double-clicking a vertex removes it (${points.length / 6} vertices)`);
    const animatedKeys = () => editor.run((id) => Object.keys(montage.clip(0).animations).filter((k) => k.startsWith(`node.${id}.points.`)).length, mask);
    await editor.run((id) => {
      montage.graph.keyframe(0, id, 'points.0', 0, -0.2);
      montage.graph.keyframe(0, id, 'points.0', 1, -0.3);
    }, mask);
    await page.locator('#mask-overlay .mask-add').first().click();
    const afterAdd = await animatedKeys();
    points = (await nodeParams(mask)).points;
    checks.check(points.length === 30 && afterAdd === 7, `a vertex can be added to an animated mask; it gets keys for every coordinate (${points.length / 6} vertices, ${afterAdd} animated coordinates)`);
    await page.locator('#mask-overlay .mask-point').nth(1).dblclick();
    points = (await nodeParams(mask)).points;
    checks.check(points.length === 24 && (await animatedKeys()) === 1, 'and removed again with its keys');
    await editor.run((id) => montage.clearKeyframes(0, `node.${id}.points.0`), mask);

    const blur = await editor.run(() => montage.graph.add(0, 'blur'));
    await selectNode(blur);
    await editor.until((id) => !!document.querySelector(`#node-${id}-radius`), blur);
    await setRange(editor, `#node-${blur}-radius`, 12);
    checks.check((await nodeParams(blur)).radius === 12, 'node inspector sliders change node parameters');
    const text = await editor.run(() => montage.graph.add(0, 'text'));
    await selectNode(text);
    await page.fill(`#node-${text}-text`, 'Typed in');
    checks.check((await nodeParams(text)).text === 'Typed in', 'the text parameter is edited in the inspector');

    dialogs.push('My blur');
    await selectNode(blur);
    await page.click('#node-save-template');
    await editor.until(() => montage.templates.list().some((t) => t.name === 'My blur'));
    const option = await page.locator('#node-add option', { hasText: 'My blur' }).getAttribute('value');
    const countBefore = await editor.run(() => montage.graph.get(0).nodes.length);
    await page.selectOption('#node-add', option);
    const countAfter = await editor.run(() => montage.graph.get(0).nodes.length);
    checks.check(countAfter === countBefore + 1, `Save template stores the node and the add list inserts it (${countBefore} → ${countAfter})`);

    await editor.run(() => montage.graph.disable(0));
    await editor.run(() => montage.select(1));
    await editor.run(() => montage.seek(montage.clip(1).start));
    const ellipse = await editor.run(() => montage.graph.add(1, 'ellipse-mask'));
    await editor.run(() => montage.select(1));
    await selectNode(ellipse);
    await page.locator(`#node-inspector [data-track="center"]`).click();
    await editor.until(() => !document.querySelector('#point-picker').hidden);
    await page.keyboard.press('Escape');
    checks.check(await page.locator('#point-picker').isHidden(), 'Escape cancels picking a tracking point');
    await page.locator(`#node-inspector [data-track="center"]`).click();
    const screen = await page.locator('.screen').boundingBox();
    const aspect = 640 / 360;
    const w = screen.width / screen.height > aspect ? screen.height * aspect : screen.width;
    const h = screen.width / screen.height > aspect ? screen.height : screen.width / aspect;
    await page.mouse.click(screen.x + (screen.width - w) / 2 + (150 / 640) * w, screen.y + (screen.height - h) / 2 + h / 2);
    const keys = await editor.until((id) => (montage.clip(1).animations[`node.${id}.center.0`]?.length ?? 0) > 10, ellipse, 30000).then(() => true, () => false);
    checks.check(keys, 'the node Track button and a viewer click write follow keyframes');
    await page.click('#view-timeline');

    await editor.run(() => montage.select(0));
    await page.selectOption('#color-science', 'aces');
    checks.check((await editor.run(() => montage.colorScience())) === 'aces', 'the working space select switches the project to ACES');
    await page.selectOption('#color-input-space', 'logc3');
    checks.check((await editor.run(() => montage.colorSpace(0))) === 'logc3', 'the input color space select sets the media color space');
    await page.selectOption('#color-science', 'display');

    dialogs.push('Neutral');
    await page.click('#grade-version-save');
    await editor.run(() => montage.grade(0, { exposure: 1 }));
    dialogs.push('Bright');
    await page.click('#grade-version-save');
    await page.selectOption('#grade-version', 'Neutral');
    const exposure = await editor.run(() => montage.clip(0).effects.find((e) => e.type === 'grade')?.params.exposure ?? 0);
    checks.check(exposure === 0, `the version select restores the saved grade (exposure ${exposure})`);

    await editor.run(() => montage.seek(0.5));
    await page.click('#still-grab');
    await editor.until(() => montage.stills.list().length === 1);
    await page.locator('#stills-grid figure img').first().click();
    await editor.until(() => document.querySelector('#stills-grid figure')?.classList.contains('active'));
    checks.check(!(await page.locator('#still-wipe').isHidden()), 'clicking a still starts the wipe and shows its slider');
    await setRange(editor, '#still-wipe', 0.8);
    await page.locator('#stills-grid [data-action="apply"]').first().click();
    await page.locator('#stills-grid [data-action="remove"]').first().click();
    await editor.until(() => montage.stills.list().length === 0);
    checks.check((await page.locator('#stills-grid figure').count()) === 0, 'deleting a still removes it from the gallery');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
