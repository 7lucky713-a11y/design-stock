import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { r2 } from '@/lib/r2';

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MAX_BYTES = 4 * 1024 * 1024;

export const runtime = 'nodejs';

function validSignature(payload: string, signature: string) {
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  if (!secret) throw new Error('R2_SECRET_ACCESS_KEY is not configured');
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function PUT(request: Request) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    const contentType = url.searchParams.get('contentType');
    const expiresRaw = url.searchParams.get('expires');
    const sig = url.searchParams.get('sig');

    if (!key || !contentType || !expiresRaw || !sig || !ACCEPTED.has(contentType)) {
      return NextResponse.json({ error: 'Invalid upload request' }, { status: 400 });
    }

    const expires = Number(expiresRaw);
    if (!Number.isFinite(expires) || Date.now() > expires) {
      return NextResponse.json({ error: 'Upload URL expired' }, { status: 401 });
    }

    const payload = `${key}:${contentType}:${expires}`;
    if (!validSignature(payload, sig)) {
      return NextResponse.json({ error: 'Invalid upload signature' }, { status: 401 });
    }

    const requestType = request.headers.get('content-type')?.split(';')[0] || '';
    if (requestType !== contentType) {
      return NextResponse.json({ error: 'Content type mismatch' }, { status: 400 });
    }

    const body = Buffer.from(await request.arrayBuffer());
    if (body.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be 4MB or smaller' }, { status: 413 });
    }

    const bucket = process.env.R2_BUCKET;
    if (!bucket) throw new Error('R2_BUCKET is not configured');

    await r2().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    }));

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('R2 upload proxy failed', error);
    return NextResponse.json({ error: 'R2 upload failed' }, { status: 500 });
  }
}
