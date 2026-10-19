import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const sha = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function startS3({ accessKeyId = 'TESTKEY', secretAccessKey = 'TESTSECRET', bucket = 'media', region = 'us-east-1' } = {}) {
  const objects = new Map();
  const uploads = new Map();
  const log = { requests: 0, rejected: 0, ranges: 0, parts: 0 };

  const verify = (req, url, body) => {
    const q = url.searchParams;
    const canonicalQuery = (skip) => [...q.entries()].filter(([k]) => k !== skip).map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
    let credential, signed, signature, stamp, payload, query;
    if (q.has('X-Amz-Signature')) {
      credential = q.get('X-Amz-Credential');
      signed = q.get('X-Amz-SignedHeaders').split(';');
      signature = q.get('X-Amz-Signature');
      stamp = q.get('X-Amz-Date');
      payload = 'UNSIGNED-PAYLOAD';
      query = canonicalQuery('X-Amz-Signature');
      const issued = Date.parse(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`);
      if (Date.now() > issued + Number(q.get('X-Amz-Expires')) * 1000) return 'expired';
    } else {
      const auth = /Credential=([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(req.headers.authorization ?? '');
      if (!auth) return 'missing authorization';
      [, credential, signed, signature] = auth;
      signed = signed.split(';');
      stamp = req.headers['x-amz-date'];
      payload = req.headers['x-amz-content-sha256'];
      if (payload !== 'UNSIGNED-PAYLOAD' && payload !== sha(body)) return 'payload hash mismatch';
      query = canonicalQuery(null);
    }
    const [key, day, reg, service] = credential.split('/');
    if (key !== accessKeyId || reg !== region || service !== 's3') return 'bad credential';
    const headers = signed.map((h) => `${h}:${String(req.headers[h] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
    const canonical = [req.method, url.pathname, query, headers, signed.join(';'), payload].join('\n');
    const scope = `${day}/${reg}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha(canonical)].join('\n');
    const k = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), reg), 's3'), 'aws4_request');
    return createHmac('sha256', k).update(toSign).digest('hex') === signature ? null : 'signature mismatch';
  };

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const origin = req.headers.origin;
    const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'ETag, Content-Range, Content-Length, Accept-Ranges', 'access-control-allow-methods': 'GET, PUT, POST, DELETE, HEAD', 'access-control-allow-headers': '*', 'access-control-max-age': '600', 'cross-origin-resource-policy': 'cross-origin', vary: 'Origin' } : {};
    const send = (status, headers = {}, payload = '') => {
      res.writeHead(status, { ...cors, ...headers });
      res.end(payload);
    };
    if (req.method === 'OPTIONS') return send(204);
    log.requests++;
    const url = new URL(req.url, 'http://localhost');
    const problem = verify(req, url, body);
    if (problem) {
      log.rejected++;
      return send(403, { 'content-type': 'application/xml' }, `<Error><Code>SignatureDoesNotMatch</Code><Message>${problem}</Message></Error>`);
    }
    const [, b, ...rest] = url.pathname.split('/');
    if (decodeURIComponent(b) !== bucket) return send(404, {}, '<Error><Code>NoSuchBucket</Code><Message>No such bucket</Message></Error>');
    const key = rest.map(decodeURIComponent).join('/');
    const q = url.searchParams;
    if (!key && req.method === 'GET') {
      const prefix = q.get('prefix') ?? '';
      const list = [...objects.entries()].filter(([k]) => k.startsWith(prefix)).sort();
      return send(200, { 'content-type': 'application/xml' }, `<ListBucketResult><Name>${bucket}</Name><IsTruncated>false</IsTruncated>${list.map(([k, o]) => `<Contents><Key>${xml(k)}</Key><Size>${o.data.length}</Size><LastModified>${o.modified.toISOString()}</LastModified><ETag>"${o.etag}"</ETag></Contents>`).join('')}</ListBucketResult>`);
    }
    if (req.method === 'POST' && q.has('uploads')) {
      const id = `up${uploads.size + 1}`;
      uploads.set(id, { key, parts: new Map() });
      return send(200, { 'content-type': 'application/xml' }, `<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${xml(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (req.method === 'PUT' && q.has('uploadId')) {
      const upload = uploads.get(q.get('uploadId'));
      if (!upload) return send(404, {}, '<Error><Code>NoSuchUpload</Code><Message>No such upload</Message></Error>');
      const etag = createHash('md5').update(body).digest('hex');
      upload.parts.set(Number(q.get('partNumber')), { data: body, etag });
      log.parts++;
      return send(200, { etag: `"${etag}"` });
    }
    if (req.method === 'POST' && q.has('uploadId')) {
      const upload = uploads.get(q.get('uploadId'));
      const numbers = [...body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>([^<]+)<\/ETag>/g)];
      if (!upload || numbers.some(([, n, e]) => upload.parts.get(Number(n))?.etag !== e.replace(/&quot;|"/g, ''))) return send(400, {}, '<Error><Code>InvalidPart</Code><Message>Bad part list</Message></Error>');
      const data = Buffer.concat(numbers.map(([, n]) => upload.parts.get(Number(n)).data));
      objects.set(key, { data, etag: `${createHash('md5').update(data).digest('hex')}-${numbers.length}`, modified: new Date(), type: 'application/octet-stream' });
      uploads.delete(q.get('uploadId'));
      return send(200, { 'content-type': 'application/xml' }, `<CompleteMultipartUploadResult><Key>${xml(key)}</Key></CompleteMultipartUploadResult>`);
    }
    if (req.method === 'DELETE' && q.has('uploadId')) {
      uploads.delete(q.get('uploadId'));
      return send(204);
    }
    if (req.method === 'PUT') {
      objects.set(key, { data: body, etag: createHash('md5').update(body).digest('hex'), modified: new Date(), type: req.headers['content-type'] ?? 'application/octet-stream' });
      return send(200, { etag: `"${objects.get(key).etag}"` });
    }
    const object = objects.get(key);
    if (req.method === 'DELETE') {
      objects.delete(key);
      return send(204);
    }
    if (!object) return send(404, { 'content-type': 'application/xml' }, '<Error><Code>NoSuchKey</Code><Message>No such key</Message></Error>');
    const base = { etag: `"${object.etag}"`, 'content-type': object.type, 'last-modified': object.modified.toUTCString(), 'accept-ranges': 'bytes' };
    if (req.method === 'HEAD') return send(200, { ...base, 'content-length': object.data.length });
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      log.ranges++;
      const start = Number(range[1]);
      const end = Math.min(object.data.length - 1, range[2] ? Number(range[2]) : object.data.length - 1);
      return send(206, { ...base, 'content-range': `bytes ${start}-${end}/${object.data.length}`, 'content-length': end - start + 1 }, object.data.subarray(start, end + 1));
    }
    return send(200, { ...base, 'content-length': object.data.length }, object.data);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  return { endpoint, bucket, region, accessKeyId, secretAccessKey, objects, log, stop: () => new Promise((r) => server.close(r)) };
}
