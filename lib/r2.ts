import { S3Client } from '@aws-sdk/client-s3';

export function r2() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials are not configured');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  });
}

export function r2PublicUrl(key: string) {
  const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (!base) return null;
  return `${base}/${key}`;
}
