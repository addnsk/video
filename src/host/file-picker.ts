export interface PickedFile {
  readonly file: File;
  readonly handle?: FileSystemFileHandle;
}

type OpenPicker = (options: {
  multiple: boolean;
  types: { description: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
}) => Promise<FileSystemFileHandle[]>;

type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;

export interface PickOptions {
  readonly description: string;
  readonly mime: string;
  readonly extensions: readonly string[];
  readonly multiple: boolean;
}

const openPicker = () => (globalThis as unknown as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker;
const savePicker = () => (globalThis as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;

function inputPick(options: PickOptions): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = options.multiple;
    input.accept = [options.mime, ...options.extensions].join(',');
    input.addEventListener('change', () => resolve([...(input.files ?? [])].map((file) => ({ file }))));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export async function pickFiles(options: PickOptions): Promise<PickedFile[]> {
  const picker = openPicker();
  if (!picker) return inputPick(options);
  try {
    const handles = await picker({
      multiple: options.multiple,
      types: [{ description: options.description, accept: { [options.mime]: [...options.extensions] } }],
    });
    return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
  } catch (e) {
    if ((e as Error).name === 'AbortError') return [];
    return inputPick(options);
  }
}

export async function saveBlob(blob: Blob, name: string, description: string, mime: string, extension: string): Promise<boolean> {
  const picker = savePicker();
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description, accept: { [mime]: [extension] } }] });
      const stream = await (handle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
      await stream.write(blob);
      await stream.close();
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export const MEDIA_TYPES: Omit<PickOptions, 'multiple'> = {
  description: 'Video',
  mime: 'video/*',
  extensions: ['.mov', '.mp4', '.m4v', '.mkv', '.webm', '.mxf'],
};

export const PROJECT_TYPES: Omit<PickOptions, 'multiple'> = {
  description: 'Montage project',
  mime: 'application/json',
  extensions: ['.json'],
};
