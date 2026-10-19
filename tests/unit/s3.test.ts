import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Client, S3Error } from '../../src/host/remote/s3';
import { startS3 } from '../e2e/lib/s3-server.mjs';

let s3: Awaited<ReturnType<typeof startS3>>;
let client: S3Client;

beforeAll(async () => {
  s3 = await startS3();
  client = new S3Client({ endpoint: s3.endpoint, region: s3.region, bucket: s3.bucket, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, prefix: '/team/' });
});
afterAll(() => s3.stop());

describe('S3 client', () => {
  it('puts, lists, reads and deletes objects with odd names', async () => {
    const key = client.key('projects/Cut (final) & ünïcode.json');
    expect(key).toBe('team/projects/Cut (final) & ünïcode.json');
    await client.put(key, '{"a":1}', 'application/json');
    expect((await client.list('projects/')).map((o) => [o.key, o.size])).toEqual([[key, 7]]);
    expect(await (await client.get(key)).text()).toBe('{"a":1}');
    expect((await client.head(key))?.size).toBe(7);
    await client.delete(key);
    expect(await client.head(key)).toBeNull();
    expect(s3.log.rejected).toBe(0);
  });

  it('uploads large files in parts and reads them back', async () => {
    const data = new Uint8Array(20 * 1024 * 1024 + 123).map((_, i) => i % 251);
    const seen: number[] = [];
    await client.upload(client.key('media/big.bin'), new Blob([data]), (f) => seen.push(f));
    const stored = s3.objects.get('team/media/big.bin')!.data;
    expect(stored.length).toBe(data.length);
    expect(Buffer.compare(stored, Buffer.from(data))).toBe(0);
    expect(seen.at(-1)).toBe(1);
  });

  it('presigns URLs the storage accepts and reports refusals clearly', async () => {
    await client.put(client.key('media/a.txt'), 'hello world');
    const url = await client.presign(client.key('media/a.txt'));
    const part = await fetch(url, { headers: { range: 'bytes=6-10' } });
    expect([part.status, await part.text()]).toEqual([206, 'world']);
    const bad = new S3Client({ ...client.config, secretAccessKey: 'nope' });
    await expect(bad.list()).rejects.toBeInstanceOf(S3Error);
    await expect(bad.list()).rejects.toThrow(/SignatureDoesNotMatch/);
  });
});
