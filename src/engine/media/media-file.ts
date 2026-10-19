import {
  ALL_FORMATS,
  AudioSampleSink,
  Input,
  VideoSampleSink,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';
import { resources } from '../resources';
import { sourceOf, type MediaInput } from './media-input';

const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;

export class MediaFile {
  private input: Input;
  private videoTrack: Promise<InputVideoTrack | null>;
  private audioTrack: Promise<InputAudioTrack | null>;
  private videoSink: Promise<VideoSampleSink | null> | null = null;
  private audioSink: Promise<AudioSampleSink | null> | null = null;
  private refs = 0;
  lastUsed = 0;

  constructor(
    readonly file: MediaInput,
    readonly timeOffset: number,
  ) {
    this.input = new Input({ source: sourceOf(file, SOURCE_CACHE_BYTES), formats: ALL_FORMATS });
    this.videoTrack = this.input.getPrimaryVideoTrack();
    this.audioTrack = this.input
      .getPrimaryAudioTrack()
      .then(async (t) => (t && (await t.canDecode()) ? t : null));
    resources.acquire('decoder');
  }

  get busy(): boolean {
    return this.refs > 0;
  }

  retain(): () => void {
    this.refs++;
    this.lastUsed = performance.now();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs--;
      this.lastUsed = performance.now();
    };
  }

  video(): Promise<VideoSampleSink | null> {
    this.videoSink ??= this.videoTrack.then((t) => (t ? new VideoSampleSink(t) : null));
    return this.videoSink;
  }

  audio(): Promise<AudioSampleSink | null> {
    this.audioSink ??= this.audioTrack.then((t) => (t ? new AudioSampleSink(t) : null));
    return this.audioSink;
  }

  firstTimestamp(): Promise<number> {
    return this.videoTrack.then((t) => (t ? t.getFirstTimestamp() : 0));
  }

  dispose(): void {
    this.input.dispose();
    resources.release('decoder');
  }
}
