export interface TestS3 {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly objects: Map<string, { data: Buffer; etag: string; modified: Date; type: string }>;
  readonly log: { requests: number; rejected: number; ranges: number; parts: number };
  stop(): Promise<void>;
}
export function startS3(options?: { accessKeyId?: string; secretAccessKey?: string; bucket?: string; region?: string }): Promise<TestS3>;
