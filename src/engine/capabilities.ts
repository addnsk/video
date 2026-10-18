export interface GpuCapabilities {
  readonly vendor: string;
  readonly renderer: string;
  readonly maxTextureSize: number;
  readonly max3dTextureSize: number;
  readonly maxRenderbufferSize: number;
  readonly floatTargets: boolean;
  readonly floatLinear: boolean;
}

export interface CodecSupport {
  readonly label: string;
  readonly decode: boolean;
  readonly encode: boolean;
}

export interface EngineCapabilities {
  readonly gpu: GpuCapabilities | null;
  readonly codecs: readonly CodecSupport[];
  readonly workers: boolean;
}

interface CodecProbe {
  readonly label: string;
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly software?: boolean;
}

const PROBES: readonly CodecProbe[] = [
  { label: 'H.264 1080p', codec: 'avc1.640028', width: 1920, height: 1080 },
  { label: 'H.264 4K', codec: 'avc1.640033', width: 3840, height: 2160 },
  { label: 'HEVC 1080p', codec: 'hvc1.1.6.L120.B0', width: 1920, height: 1080 },
  { label: 'HEVC 10-bit 4K', codec: 'hvc1.2.4.L153.B0', width: 3840, height: 2160 },
  { label: 'VP9 1080p', codec: 'vp09.00.40.08', width: 1920, height: 1080 },
  { label: 'VP9 4K', codec: 'vp09.00.51.08', width: 3840, height: 2160 },
  { label: 'AV1 1080p', codec: 'av01.0.08M.08', width: 1920, height: 1080 },
  { label: 'AV1 10-bit 4K', codec: 'av01.0.12M.10', width: 3840, height: 2160 },
];

async function supported(fn: () => Promise<{ supported?: boolean }>): Promise<boolean> {
  try {
    return !!(await fn()).supported;
  } catch {
    return false;
  }
}

export async function probeCodecs(): Promise<CodecSupport[]> {
  const hasDecoder = typeof VideoDecoder !== 'undefined';
  const hasEncoder = typeof VideoEncoder !== 'undefined';
  const out = await Promise.all(
    PROBES.map(async (p): Promise<CodecSupport> => ({
      label: p.label,
      decode: hasDecoder && (await supported(() => VideoDecoder.isConfigSupported({ codec: p.codec, codedWidth: p.width, codedHeight: p.height }))),
      encode: hasEncoder && (await supported(() => VideoEncoder.isConfigSupported({ codec: p.codec, width: p.width, height: p.height, bitrate: 8_000_000 }))),
    })),
  );
  return [...out, { label: 'ProRes 422 (built-in)', decode: true, encode: true }];
}

export function gpuCapabilities(gl: WebGL2RenderingContext, floatTargets: boolean): GpuCapabilities {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: String(debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
    renderer: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    max3dTextureSize: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number,
    maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    floatTargets,
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
  };
}
