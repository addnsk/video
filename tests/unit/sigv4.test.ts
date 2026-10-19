import { describe, expect, it } from 'vitest';
import { EMPTY_HASH, presignUrl, signRequest } from '../../src/host/remote/sigv4';

const S3_KEYS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };

describe('AWS Signature Version 4', () => {
  it('matches the AWS test suite get-vanilla vector', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: new URL('https://example.amazonaws.com/'),
      region: 'us-east-1',
      service: 'service',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
      date: new Date('2015-08-30T12:36:00Z'),
    });
    expect(headers.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });

  it('matches the S3 documentation example for a ranged GET', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY_HASH,
      region: 'us-east-1',
      service: 's3',
      credentials: S3_KEYS,
      date: new Date('2013-05-24T00:00:00Z'),
    });
    expect(headers.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('matches the S3 documentation example for a presigned URL', async () => {
    const url = await presignUrl({ method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), region: 'us-east-1', service: 's3', credentials: S3_KEYS, date: new Date('2013-05-24T00:00:00Z'), expires: 86400 });
    expect(new URL(url).searchParams.get('X-Amz-Signature')).toBe('aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });
});
