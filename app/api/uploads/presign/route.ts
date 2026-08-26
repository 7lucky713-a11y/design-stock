import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';
import { r2, r2PublicUrl } from '@/lib/r2';

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export async function POST(request: Request) {
  try {
    const { fileName, contentType } = await request.json();
    if (!fileName || !ACCEPTED.has(contentType)) {
      return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 });
    }

    const ext = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'webp';
    const key = `design-stock/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const bucket = process.env.R2_BUCKET;
    if (!bucket) throw new Error('R2_BUCKET is not configured');

    const uploadUrl = await getSignedUrl(
      r2(),
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: 600 }
    );

    return NextResponse.json({ uploadUrl, key, publicUrl: r2PublicUrl(key) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not prepare upload' }, { status: 500 });
  }
}
