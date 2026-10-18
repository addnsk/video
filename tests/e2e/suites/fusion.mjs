import { Editor, fixture } from '../harness.mjs';

const CENTER = { x: 0.5, y: 0.5, size: 0.04 };
const EDGE = { x: 0.25, y: 0.5, size: 0.04 };
const fmt = (c) => c.map((v) => v.toFixed(0)).join(',');

export default {
  name: 'fusion',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('red.mov'), fixture('gray.mov')]);
    const color = (region = CENTER, time = 0.5) => editor.previewColorAt(time, region);

    const grayTime = await editor.run(() => montage.clip(1).start + 0.5);
    await editor.run(() => montage.grade(1, { exposure: 0.5 }));
    const chain = await color(CENTER, grayTime);
    await editor.run(() => montage.graph.enable(1));
    const converted = await color(CENTER, grayTime);
    checks.check(Math.abs(chain[0] - converted[0]) < 2, `converting the effect chain to a graph keeps the image (${fmt(chain)} vs ${fmt(converted)})`);
    checks.check((await editor.run(() => montage.graph.get(1).editable)) === true, 'graph is editable after enabling');

    const invert = await editor.run(() => {
      const id = montage.graph.add(0, 'invert');
      montage.graph.connect(0, 'source', id);
      montage.graph.connect(0, id, 'output');
      return id;
    });
    const [ir, ig, ib] = await color();
    checks.check(ir < 40 && ig > 200 && ib > 200, `invert node renders (${fmt([ir, ig, ib])})`);
    await editor.run((id) => montage.graph.toggle(0, id, false), invert);
    checks.check((await color())[0] > 200, 'disabled node passes its input through');
    await editor.run((id) => montage.graph.remove(0, id), invert);

    const nodes = await editor.run(() => {
      const bg = montage.graph.add(0, 'background', { color: [0, 1, 0, 1] });
      const mask = montage.graph.add(0, 'ellipse-mask', { size: [0.3, 0.3], softness: 0 });
      const merge = montage.graph.add(0, 'merge');
      montage.graph.connect(0, bg, merge, 'background');
      montage.graph.connect(0, 'source', merge, 'foreground');
      montage.graph.connect(0, mask, merge, 'mask');
      montage.graph.connect(0, merge, 'output');
      return { bg, mask, merge };
    });
    const [cr, cg] = await color();
    const [er, eg] = await color(EDGE);
    checks.check(cr > 200 && cg < 50 && eg > 200 && er < 50, `merge with an ellipse mask composites (center ${fmt([cr, cg])}, edge ${fmt([er, eg])})`);

    await editor.run(({ merge }) => montage.graph.set(0, merge, { mode: 'add' }), nodes);
    const [ar, ag] = await color();
    checks.check(ar > 200 && ag > 200, `add blend mode mixes layers (${fmt([ar, ag])})`);
    await editor.run(({ merge }) => montage.graph.set(0, merge, { mode: 'normal' }), nodes);

    await editor.run(({ merge }) => {
      montage.graph.keyframe(0, merge, 'opacity', 0, 0);
      montage.graph.keyframe(0, merge, 'opacity', 1, 1);
    }, nodes);
    const start = await color(CENTER, 0.01);
    const later = await color(CENTER, 1.5);
    checks.check(start[1] > 200 && later[0] > 200, `node parameters animate with keyframes (${fmt(start)} → ${fmt(later)})`);

    const transform = await editor.run(({ merge }) => {
      const t = montage.graph.add(0, 'transform', { scale: 0.25 });
      montage.graph.connect(0, 'source', t);
      montage.graph.connect(0, t, merge, 'foreground');
      montage.graph.disconnect(0, merge, 'mask');
      return t;
    }, nodes);
    const tc = await color(CENTER, 1.5);
    const te = await color(EDGE, 1.5);
    checks.check(tc[0] > 200 && te[1] > 200, `transform node scales the input over the background (center ${fmt(tc)}, edge ${fmt(te)})`);

    await editor.run((t) => montage.graph.set(0, t, { scale: 1 }), transform);
    for (const type of ['blur', 'glow', 'crop', 'gradient', 'rectangle-mask']) {
      await editor.run(({ type, merge }) => {
        const id = montage.graph.add(0, type);
        if (type !== 'gradient' && type !== 'rectangle-mask') montage.graph.connect(0, 'source', id);
        montage.graph.connect(0, id, merge, 'foreground');
      }, { type, ...nodes });
      await color(CENTER, 1.5);
    }
    checks.check(editor.errors.length === 0, 'blur, glow, crop, gradient and rectangle mask render without errors');

    await editor.run(({ merge }) => montage.batch(() => {
      montage.nodes.register({
        id: 'channel-swap',
        name: 'Channel swap',
        passes: ['vec4 process(vec2 uv) { vec4 c = input_source(uv); return vec4(c.b, c.r, c.g, c.a); }', 'vec4 process(vec2 uv) { return previous(uv) * gain; }'],
        params: [{ name: 'gain', type: 'float', default: 1 }],
      });
      const id = montage.graph.add(0, 'channel-swap', { gain: 1 });
      montage.graph.connect(0, 'source', id);
      montage.graph.connect(0, id, merge, 'foreground');
    }), nodes);
    const [sr, sg] = await color(CENTER, 1.5);
    checks.check(sr < 50 && sg > 200, `custom multi-pass node from the API renders (${fmt([sr, sg])})`);

    const undone = await editor.run(() => {
      montage.undo();
      return montage.graph.get(0).nodes.some((n) => n.type === 'channel-swap');
    });
    checks.check(!undone, 'graph edits undo');
    await editor.run(() => montage.graph.disable(0));
    checks.check((await color(CENTER, 1.5))[0] > 200, 'disabling the graph restores the plain clip');

    await editor.run(() => montage.select(1));
    await editor.page.click('#view-nodes');
    await editor.page.selectOption('#node-add', 'invert');
    await editor.until(() => (document.querySelector('#node-canvas').dataset.ports ?? '').includes('"invert"'));
    const ports = async () => JSON.parse(await editor.page.getAttribute('#node-canvas', 'data-ports'));
    const box = await editor.page.locator('#node-canvas').boundingBox();
    const drag = async (from, to) => {
      await editor.page.mouse.move(box.x + from.x, box.y + from.y);
      await editor.page.mouse.down();
      await editor.page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
      await editor.page.mouse.up();
    };
    let p = await ports();
    const invertId = Object.keys(p).find((id) => p[id].type === 'invert');
    await drag(p.source.output, p[invertId].inputs[0]);
    await drag(p[invertId].output, p.output.inputs[0]);
    const links = await editor.run(() => montage.graph.get(1).links);
    checks.check(links.some((l) => l.from === 'source' && l.to === invertId) && links.some((l) => l.from === invertId && l.to === 'output'), 'node editor connects nodes by dragging between ports');
    const [nr] = await color(CENTER, grayTime);
    checks.near(nr, 255 - 128, 6, "graph edited in the UI renders the inverted clip");
    p = await ports();
    await editor.page.mouse.click(box.x + p[invertId].center[0], box.y + p[invertId].center[1]);
    checks.check(await editor.page.isVisible('#node-enabled'), 'clicking a node opens its inspector');
    await editor.page.keyboard.press('Delete');
    checks.check(!(await editor.run((id) => montage.graph.get(1).nodes.some((n) => n.id === id), invertId)), 'Delete removes the selected node');
    await editor.page.click('#view-timeline');
    checks.check(await editor.page.isVisible('#timeline'), 'switching back shows the timeline');

    await editor.import([fixture('greenscreen.mov')], 3);
    await editor.until(() => montage.clips().length === 3);
    const keyTime = await editor.run(() => montage.clip(2).start + 0.5);
    const key = await editor.run(() => montage.batch(() => {
      const bg = montage.graph.add(2, 'background', { color: [0, 0, 1, 1] });
      const keyer = montage.graph.add(2, 'keyer', { key: [0.063, 0.816, 0.125, 1] });
      const merge = montage.graph.add(2, 'merge');
      montage.graph.connect(2, 'source', keyer);
      montage.graph.connect(2, bg, merge, 'background');
      montage.graph.connect(2, keyer, merge, 'foreground');
      montage.graph.connect(2, merge, 'output');
      return keyer;
    }));
    const subject = await color(CENTER, keyTime);
    const screen = await color(EDGE, keyTime);
    checks.check(subject[0] > 150 && subject[1] < 80 && screen[2] > 200 && screen[1] < 60, `chroma key removes the green screen (subject ${fmt(subject)}, screen ${fmt(screen)})`);
    await editor.run((id) => montage.graph.view(2, id), key);
    await editor.run((id) => montage.graph.set(2, id, { matte: true }), key);
    const matte = await color(EDGE, keyTime);
    const solid = await color(CENTER, keyTime);
    checks.check(matte[0] < 30 && solid[0] > 220, `viewing the keyer shows its matte (${fmt(matte)} / ${fmt(solid)})`);
    checks.check(await editor.page.isVisible('#viewing-node'), 'viewer shows which node is displayed');
    await editor.run((id) => montage.graph.set(2, id, { matte: false }), key);
    await editor.page.click('#viewing-node');
    checks.check((await color(EDGE, keyTime))[2] > 200, 'leaving node view shows the output again');

    const maskId = await editor.run(() => montage.batch(() => {
      montage.graph.disable(0);
      const bg = montage.graph.add(0, 'background', { color: [0, 0, 1, 1] });
      const mask = montage.graph.add(0, 'polygon-mask', { spline: false, feather: 0 });
      const merge = montage.graph.add(0, 'merge');
      montage.graph.connect(0, bg, merge, 'background');
      montage.graph.connect(0, 'source', merge, 'foreground');
      montage.graph.connect(0, mask, merge, 'mask');
      montage.graph.connect(0, merge, 'output');
      montage.select(0);
      return mask;
    }));
    const inMask = await color(CENTER, 0.5);
    checks.check(inMask[0] > 200, `polygon mask reveals the clip inside (${fmt(inMask)})`);
    await editor.page.click('#view-nodes');
    let mp = await ports();
    while (!mp[maskId]) {
      await editor.settle(200);
      mp = await ports();
    }
    const nodeBox = await editor.page.locator('#node-canvas').boundingBox();
    await editor.page.mouse.click(nodeBox.x + mp[maskId].center[0], nodeBox.y + mp[maskId].center[1]);
    await editor.until(() => getComputedStyle(document.querySelector('#mask-overlay')).display !== 'none');
    checks.check((await editor.page.locator('#mask-overlay .mask-point').count()) === 4, 'selecting a polygon mask shows its points on the viewer');
    const handle = await editor.page.locator('#mask-overlay .mask-point').nth(2).boundingBox();
    await editor.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await editor.page.mouse.down();
    await editor.page.mouse.move(handle.x + 120, handle.y + 60, { steps: 6 });
    await editor.page.mouse.up();
    const moved = await editor.run((id) => montage.graph.get(0).nodes.find((n) => n.id === id).params.points, maskId);
    checks.check(moved[4] > 0.3 && moved[5] > 0.3, `dragging a point on the viewer moves it (${moved.slice(4, 6).map((v) => v.toFixed(2))})`);
    await editor.page.locator('#mask-overlay .mask-add').first().click();
    const added = await editor.run((id) => montage.graph.get(0).nodes.find((n) => n.id === id).params.points.length, maskId);
    checks.check(added === 10, `clicking an edge handle inserts a point (${added / 2} points)`);
    await editor.page.click('#view-timeline');

    const cachedBytes = await editor.run(async () => (await montage.stats()).memory.consumers.nodeCache);
    checks.check(cachedBytes > 0, `static node results are cached (${Math.round(cachedBytes / 1024)} KB)`);
    const stats = await editor.stats();
    checks.check((stats.resources.framebuffer?.live ?? 0) <= 24, `render targets stay pooled, node cache included (${stats.resources.framebuffer?.live})`);
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
