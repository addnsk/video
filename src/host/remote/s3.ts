import { child, children, parseXml, textOf, type XmlNode } from '../../core/interchange/xml';
import { encodePath, encodeRfc3986, presignUrl, sha256Hex, signRequest, UNSIGNED_PAYLOAD, type Credentials } from './sigv4';

export interface S3Config extends Credentials {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly prefix?: string;
  readonly pathStyle?: boolean;
}

export interface S3Object {
  readonly key: string;
  readonly size: number;
  readonly lastModified: number;
  readonly etag: string;
}

export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const PART_SIZE = 16 * 1024 * 1024;
const MIN_PART = 5 * 1024 * 1024;
const RETRIES = 3;

const text = (node: XmlNode | null) => (node ? textOf(node).trim() : '');

export class S3Client {
  constructor(readonly config: S3Config) {
    if (!/^https?:\/\//.test(config.endpoint)) throw new Error('The endpoint must start with https:// or http://');
    if (!config.bucket) throw new Error('Choose a bucket');
  }

  key(path: string): string {
    const prefix = (this.config.prefix ?? '').replace(/^\/+|\/+$/g, '');
    return prefix ? `${prefix}/${path}` : path;
  }

  url(key = '', query: Record<string, string> = {}): URL {
    const endpoint = new URL(this.config.endpoint);
    const base = this.config.pathStyle ?? true ? `${endpoint.origin}/${encodeRfc3986(this.config.bucket)}` : `${endpoint.protocol}//${this.config.bucket}.${endpoint.host}`;
    const url = new URL(`${base}${key ? `/${encodePath(key)}` : '/'}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url;
  }

  private async send(method: string, url: URL, options: { headers?: Record<string, string>; body?: BodyInit | Uint8Array; hash?: string; signal?: AbortSignal } = {}): Promise<Response> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const headers = await signRequest({ method, url, headers: options.headers, payloadHash: options.hash ?? UNSIGNED_PAYLOAD, region: this.config.region, service: 's3', credentials: this.config });
      let response: Response;
      try {
        response = await fetch(url, { method, headers, body: options.body as BodyInit | undefined, signal: options.signal, mode: 'cors', credentials: 'omit' });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        lastError = new Error(`Cannot reach ${url.host}: the endpoint is offline or its CORS settings do not allow this site`);
        continue;
      }
      if (response.ok || response.status === 206 || response.status === 304) return response;
      const body = await response.text().catch(() => '');
      const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? String(response.status);
      const message = /<Message>([^<]+)<\/Message>/.exec(body)?.[1] ?? response.statusText;
      lastError = new S3Error(response.status, code, `${code}: ${message}`);
      if (response.status < 500 && response.status !== 429) break;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
    throw lastError;
  }

  async list(prefix = ''): Promise<S3Object[]> {
    const out: S3Object[] = [];
    let token: string | null = null;
    do {
      const query: Record<string, string> = { 'list-type': '2', prefix: this.key(prefix) };
      if (token) query['continuation-token'] = token;
      const response = await this.send('GET', this.url('', query), { hash: await sha256Hex('') });
      const root = parseXml(await response.text());
      for (const node of children(root, 'Contents'))
        out.push({ key: text(child(node, 'Key')), size: Number(text(child(node, 'Size'))), lastModified: Date.parse(text(child(node, 'LastModified'))) || 0, etag: text(child(node, 'ETag')).replace(/"/g, '') });
      token = text(child(root, 'IsTruncated')) === 'true' ? text(child(root, 'NextContinuationToken')) || null : null;
    } while (token);
    return out;
  }

  async head(key: string): Promise<{ size: number; lastModified: number; type: string } | null> {
    try {
      const response = await this.send('HEAD', this.url(key), { hash: await sha256Hex('') });
      return { size: Number(response.headers.get('content-length') ?? 0), lastModified: Date.parse(response.headers.get('last-modified') ?? '') || 0, type: response.headers.get('content-type') ?? '' };
    } catch (e) {
      if (e instanceof S3Error && e.status === 404) return null;
      throw e;
    }
  }

  async get(key: string): Promise<Blob> {
    const response = await this.send('GET', this.url(key), { hash: await sha256Hex('') });
    return response.blob();
  }

  async put(key: string, body: Blob | string, type = 'application/octet-stream'): Promise<void> {
    const bytes = new Uint8Array(typeof body === 'string' ? new TextEncoder().encode(body) : await body.arrayBuffer());
    await this.send('PUT', this.url(key), { body: bytes, hash: await sha256Hex(bytes), headers: { 'content-type': type } });
  }

  async delete(key: string): Promise<void> {
    await this.send('DELETE', this.url(key), { hash: await sha256Hex('') });
  }

  async upload(key: string, file: Blob, onProgress: (fraction: number) => void = () => undefined, signal?: AbortSignal): Promise<void> {
    if (file.size <= PART_SIZE) {
      await this.put(key, file, file.type || 'application/octet-stream');
      onProgress(1);
      return;
    }
    const created = await this.send('POST', this.url(key, { uploads: '' }), { hash: await sha256Hex(''), headers: { 'content-type': file.type || 'application/octet-stream' } });
    const uploadId = text(child(parseXml(await created.text()), 'UploadId'));
    if (!uploadId) throw new Error('The storage did not start a multipart upload');
    const parts: { number: number; etag: string }[] = [];
    try {
      const count = Math.ceil(file.size / PART_SIZE);
      for (let i = 0; i < count; i++) {
        if (signal?.aborted) throw new DOMException('Upload canceled', 'AbortError');
        const start = i * PART_SIZE;
        const end = i === count - 2 && file.size - (start + PART_SIZE) < MIN_PART ? file.size : Math.min(file.size, start + PART_SIZE);
        const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
        const response = await this.send('PUT', this.url(key, { partNumber: String(i + 1), uploadId }), { body: bytes, hash: await sha256Hex(bytes), signal });
        const etag = response.headers.get('etag');
        if (!etag) throw new Error('The storage did not return an ETag; expose the ETag header in the bucket CORS settings');
        parts.push({ number: i + 1, etag });
        onProgress(end / file.size);
        if (end === file.size) break;
      }
      const body = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.number}</PartNumber><ETag>${p.etag.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
      const done = await this.send('POST', this.url(key, { uploadId }), { body, hash: await sha256Hex(body), headers: { 'content-type': 'application/xml' } });
      const reply = await done.text();
      if (reply.includes('<Error>')) throw new S3Error(500, /<Code>([^<]+)/.exec(reply)?.[1] ?? 'Error', reply);
    } catch (e) {
      await this.send('DELETE', this.url(key, { uploadId }), { hash: await sha256Hex('') }).catch(() => undefined);
      throw e;
    }
  }

  presign(key: string, expires = 7 * 24 * 3600): Promise<string> {
    return presignUrl({ method: 'GET', url: this.url(key), region: this.config.region, service: 's3', credentials: this.config, expires });
  }
}
