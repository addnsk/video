export interface Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export interface SignInput {
  readonly method: string;
  readonly url: URL;
  readonly headers?: Record<string, string>;
  readonly payloadHash?: string;
  readonly region: string;
  readonly service: string;
  readonly credentials: Credentials;
  readonly date?: Date;
}

export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
export const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const encoder = new TextEncoder();

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, encoder.encode(data));
}

export const encodeRfc3986 = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const encodePath = (path: string) => path.split('/').map(encodeRfc3986).join('/');

const amzDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function canonicalQuery(url: URL): string {
  const pairs: [string, string][] = [];
  url.searchParams.forEach((value, key) => pairs.push([encodeRfc3986(key), encodeRfc3986(value)]));
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

const canonicalPath = (url: URL) => url.pathname || '/';

async function signingKey(secret: string, day: string, region: string, service: string) {
  const kDate = await hmac(encoder.encode(`AWS4${secret}`), day);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

async function signature(input: SignInput, headers: Record<string, string>, payloadHash: string, stamp: string): Promise<{ signature: string; signedHeaders: string; scope: string }> {
  const day = stamp.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const names = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const request = [input.method.toUpperCase(), canonicalPath(input.url), canonicalQuery(input.url), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(request)].join('\n');
  const key = await signingKey(input.credentials.secretAccessKey, day, input.region, input.service);
  return { signature: hex(await hmac(key, toSign)), signedHeaders, scope };
}

export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const stamp = amzDate(input.date ?? new Date());
  const payloadHash = input.payloadHash ?? EMPTY_HASH;
  const headers: Record<string, string> = { ...input.headers, host: input.url.host, 'x-amz-date': stamp };
  if (input.service === 's3') headers['x-amz-content-sha256'] = payloadHash;
  if (input.credentials.sessionToken) headers['x-amz-security-token'] = input.credentials.sessionToken;
  const { signature: sig, signedHeaders, scope } = await signature(input, headers, payloadHash, stamp);
  const { host: _host, ...rest } = headers;
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}` };
}

export async function presignUrl(input: Omit<SignInput, 'headers' | 'payloadHash'> & { expires: number }): Promise<string> {
  const stamp = amzDate(input.date ?? new Date());
  const url = new URL(input.url);
  const scope = `${stamp.slice(0, 8)}/${input.region}/${input.service}/aws4_request`;
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${input.credentials.accessKeyId}/${scope}`);
  url.searchParams.set('X-Amz-Date', stamp);
  url.searchParams.set('X-Amz-Expires', String(Math.max(1, Math.min(604800, Math.round(input.expires)))));
  if (input.credentials.sessionToken) url.searchParams.set('X-Amz-Security-Token', input.credentials.sessionToken);
  url.searchParams.set('X-Amz-SignedHeaders', 'host');
  const { signature: sig } = await signature({ ...input, url }, { host: url.host }, UNSIGNED_PAYLOAD, stamp);
  url.searchParams.set('X-Amz-Signature', sig);
  return url.toString();
}
