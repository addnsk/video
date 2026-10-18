import { Editor, fixture } from '../harness.mjs';

const CENTER = { x: 0.5, y: 0.5, size: 0.05 };
const CORNER = { x: 0.15, y: 0.5, size: 0.04 };
const isBlue = ([r, , b]) => b > 180 && r < 80;
const isRed = ([r, , b]) => r > 180 && b < 80;

export default {
  name: 'multitrack',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('red.mov'), fixture('blue.mov'), fixture('music.wav')]);
    const layout = await editor.run(() => ({
      main: montage.clips().map((c) => c.name),
      audio: montage.clips('a1').map((c) => c.name),
    }));
    checks.check(layout.main.join() === 'red.mov,blue.mov', `video goes to the main track (${layout.main})`);
    checks.check(layout.audio.join() === 'music.wav', `audio-only media goes to the audio track (${layout.audio})`);

    await editor.settle(2500);
    const timelineRed = await editor.run(() => {
      const canvas = document.querySelector('#timeline');
      const g = canvas.getContext('2d');
      const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 40 && data[i + 2] < 40) red++;
      return red;
    });
    checks.check(timelineRed > 500, `timeline clips show frame thumbnails (${timelineRed} red pixels)`);

    const pip = await editor.run(() => {
      const blue = montage.clip(1);
      montage.remove(1);
      const pip = montage.add(blue.assetId, { track: 'v2', start: 0, in: 0, out: 2 });
      montage.set(pip.id, { transform: { scale: 0.3 } });
      return pip.id;
    });
    checks.check(isBlue(await editor.previewColorAt(0.5, CENTER)), 'scaled overlay covers the center');
    checks.check(isRed(await editor.previewColor(CORNER)), 'main track shows around the overlay');

    await editor.run((id) => montage.set(id, { transform: { x: 0.35 } }), pip);
    checks.check(isRed(await editor.previewColorAt(0.5, CENTER)), 'moved overlay uncovers the center');
    await editor.run((id) => montage.set(id, { transform: { x: 0 } }), pip);

    await editor.run((id) => {
      montage.keyframe(id, 'opacity', 0, 0);
      montage.keyframe(id, 'opacity', 1, 1);
    }, pip);
    checks.check(isRed(await editor.previewColorAt(0, CENTER)), 'opacity keyframe 0 hides the overlay');
    const [mr, , mb] = await editor.previewColorAt(0.5, CENTER);
    checks.check(mr > 70 && mb > 70, `opacity keyframes interpolate (r ${mr.toFixed(0)}, b ${mb.toFixed(0)})`);
    checks.check(isBlue(await editor.previewColorAt(1.5, CENTER)), 'opacity holds after the last keyframe');

    await editor.run(() => montage.muteTrack('v2'));
    checks.check(isRed(await editor.previewColorAt(1.5, CENTER)), 'muted track is hidden');
    await editor.run(() => montage.muteTrack('v2', false));

    const extra = await editor.run(() => {
      const track = montage.addTrack('video');
      const title = montage.title('MONTAGE', { start: 0, duration: 2, track, size: 0.3, color: '#00ff00', background: '#00ff00ff' });
      return { track, title: title.id };
    });
    const [tr, tg, tb] = await editor.previewColorAt(1.5, CENTER);
    checks.check(tg > 180 && tr < 80 && tb < 80, `title on the top track draws over the overlay (${[tr, tg, tb].map((v) => v.toFixed(0))})`);
    await editor.run(({ title }) => montage.place(title, 'v2', 3), extra);
    checks.check(isBlue(await editor.previewColorAt(1.5, CENTER)), 'title moved later on another track');

    const popped = await editor.run(({ title }) => {
      montage.place(title, 'v2', 0);
      montage.animate(title, 'in', 'pop');
      montage.animate(title, 'out', 'fade-out');
      return montage.clip(title).presets;
    }, extra);
    checks.check(popped.in === 'pop' && popped.out === 'fade-out', 'presets are stored on the title');
    const hiddenAtStart = await editor.previewColorAt(0.01, CENTER);
    const shownInMiddle = await editor.previewColorAt(1, CENTER);
    checks.check(isRed(hiddenAtStart) && shownInMiddle[1] > 180, 'pop preset hides the title at its start and shows it later');
    await editor.run(({ title }) => montage.select(title), extra);
    checks.check((await editor.page.inputValue('#preset-in')) === 'pop', 'item panel shows the in preset');
    await editor.page.selectOption('#preset-in', '');
    checks.check(!(await editor.run(({ title }) => montage.clip(title).presets.in, extra)), 'choosing None removes the preset');

    const durations = await editor.run(async () => {
      const withAudio = (await montage.render({ height: 360, quality: 'medium' })).file?.size ?? 0;
      return { withAudio, duration: montage.duration };
    });
    checks.check(durations.withAudio > 5000, `multitrack export produced a file (${durations.withAudio} bytes)`);
    checks.check(durations.duration >= 6, `project spans the audio track (${durations.duration.toFixed(2)} s)`);

    await editor.page.setViewportSize({ width: 390, height: 844 });
    await editor.settle(800);
    const overflow = await editor.run(() => document.scrollingElement.scrollWidth - innerWidth);
    checks.check(overflow <= 0, `phone layout has no horizontal scroll (${overflow}px)`);
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
