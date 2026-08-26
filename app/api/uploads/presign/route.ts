import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { r2PublicUrl } from '@/lib/r2';

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export const runtime = 'nodejs';

function sign(payload: string) {
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  if (!secret) throw new Error('R2_SECRET_ACCESS_KEY is not configured');
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export async function POST(request: Request) {
  try {
    const { fileName, contentType } = await request.json();
    if (!fileName || !ACCEPTED.has(contentType)) {
      return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 });
    }

    const ext = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'webp';
    const key = `design-stock/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const expires = Date.now() + 10 * 60 * 1000;
    const payload = `${key}:${contentType}:${expires}`;
    const sig = sign(payload);
    const uploadUrl = `/api/uploads/put?key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(contentType)}&expires=${expires}&sig=${sig}`;

    return NextResponse.json({ uploadUrl, key, publicUrl: r2PublicUrl(key) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not prepare upload' }, { status: 500 });
  }
}
