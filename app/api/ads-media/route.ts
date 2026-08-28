import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { r2, r2PublicUrl } from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADS_DATA_API = 'https://ep-damp-resonance-awphji1s.apirest.c-12.us-east-1.aws.neon.tech/neondb/rest/v1';
const IMAGE_MAX = 3 * 1024 * 1024;
const VIDEO_MAX = 10 * 1024 * 1024;
const CHUNK_BYTES = 2_500_000;
const MAX_PARTS = 5;

const TYPE_INFO: Record<string, { max: number; ext: string }> = {
  'image/jpeg': { max: IMAGE_MAX, ext: 'jpg' },
  'image/png': { max: IMAGE_MAX, ext: 'png' },
  'image/webp': { max: IMAGE_MAX, ext: 'webp' },
  'video/mp4': { max: VIDEO_MAX, ext: 'mp4' },
  'video/webm': { max: VIDEO_MAX, ext: 'webm' }
};

function allowedOrigin(origin: string | null) {
  if (!origin) return true;
  if (origin === 'https://harfway-playback.vercel.app') return true;
  if (origin === 'https://harfway-ads-prototype.vercel.app') return true;
  if (origin === 'https://design-stock.vercel.app') return true;
  return /^https:\/\/harfway-playback-[a-z0-9-]+-harf-way\.vercel\.app$/i.test(origin);
}

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Campaign-Id, X-Upload-Id, X-Part-Number, X-File-Name, X-File-Size',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  };
  if (origin && allowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request.headers.get('origin')) });
}

function bearer(request: Request) {
  const value = request.headers.get('authorization') || '';
  return /^Bearer\s+\S+/i.test(value) ? value : '';
}

async function verifyCampaignOwner(campaignId: string, authorization: string) {
  if (!authorization) return false;
  const url = `${ADS_DATA_API}/ad_campaigns?id=eq.${encodeURIComponent(campaignId)}&select=id&limit=1`;
  const res = await fetch(url, {
    headers: {
      Authorization: authorization,
      Accept: 'application/json'
    },
    cache: 'no-store'
  });
  if (!res.ok) return false;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length === 1;
}

async function updateCampaignMedia(
  campaignId: string,
  authorization: string,
  media: { url: string; mime: string; name: string; size: number }
) {
  const url = `${ADS_DATA_API}/ad_campaigns?id=eq.${encodeURIComponent(campaignId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      media_url: media.url,
      media_mime: media.mime,
      media_name: media.name,
      media_size: media.size,
      updated_at: new Date().toISOString()
    }),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`Campaign media update failed (${res.status})`);
  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Campaign media update was not applied');
}

function cleanId(value: unknown) {
  const s = String(value || '');
  return /^[0-9a-f-]{20,64}$/i.test(s) ? s : '';
}

function cleanUploadId(value: unknown) {
  const s = String(value || '');
  return /^[0-9a-f-]{20,64}$/i.test(s) ? s : '';
}

function safeName(value: unknown) {
  return String(value || 'media').replace(/[\u0000-\u001f]/g, '').slice(0, 180) || 'media';
}

function tempKey(campaignId: string, uploadId: string, part: number) {
  return `harfway-ads/tmp/${campaignId}/${uploadId}/${part}.part`;
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  if (!allowedOrigin(origin)) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!allowedOrigin(origin)) return json(request, { error: 'Origin not allowed' }, 403);

  const authorization = bearer(request);
  if (!authorization) return json(request, { error: 'Login required' }, 401);

  const action = new URL(request.url).searchParams.get('action');
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json(request, { error: 'Invalid request' }, 400);

  const campaignId = cleanId((body as any).campaignId);
  if (!campaignId || !(await verifyCampaignOwner(campaignId, authorization))) {
    return json(request, { error: 'Campaign not found or not owned by this user' }, 403);
  }

  if (action === 'start') {
    const contentType = String((body as any).contentType || '');
    const size = Number((body as any).size || 0);
    const info = TYPE_INFO[contentType];
    if (!info) return json(request, { error: 'Unsupported media type' }, 400);
    if (!Number.isInteger(size) || size <= 0 || size > info.max) {
      const label = contentType.startsWith('video/') ? 'Video must be 10MB or smaller' : 'Image must be 3MB or smaller';
      return json(request, { error: label }, 413);
    }
    return json(request, {
      uploadId: crypto.randomUUID(),
      chunkBytes: CHUNK_BYTES,
      maxBytes: info.max
    });
  }

  if (action === 'complete') {
    const uploadId = cleanUploadId((body as any).uploadId);
    const contentType = String((body as any).contentType || '');
    const fileName = safeName((body as any).fileName);
    const size = Number((body as any).size || 0);
    const parts = Number((body as any).parts || 0);
    const info = TYPE_INFO[contentType];
    if (!uploadId || !info || !Number.isInteger(size) || size <= 0 || size > info.max) {
      return json(request, { error: 'Invalid upload metadata' }, 400);
    }
    if (!Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) {
      return json(request, { error: 'Invalid part count' }, 400);
    }

    const bucket = process.env.R2_BUCKET;
    if (!bucket) return json(request, { error: 'Storage is not configured' }, 500);

    const client = r2();
    const buffers: Buffer[] = [];
    const deleteKeys: { Key: string }[] = [];
    let total = 0;

    try {
      for (let part = 1; part <= parts; part += 1) {
        const key = tempKey(campaignId, uploadId, part);
        const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!obj.Body) throw new Error(`Missing upload part ${part}`);
        const bytes = await obj.Body.transformToByteArray();
        const buffer = Buffer.from(bytes);
        total += buffer.byteLength;
        if (total > info.max) throw new Error('Upload exceeds allowed size');
        buffers.push(buffer);
        deleteKeys.push({ Key: key });
      }
      if (total !== size) throw new Error('Uploaded size does not match the selected file');

      const finalKey = `harfway-ads/${new Date().toISOString().slice(0, 10)}/${campaignId}/${uploadId}.${info.ext}`;
      const publicUrl = r2PublicUrl(finalKey);
      if (!publicUrl) throw new Error('R2 public URL is not configured');

      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: finalKey,
        Body: Buffer.concat(buffers),
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable'
      }));

      try {
        await updateCampaignMedia(campaignId, authorization, {
          url: publicUrl,
          mime: contentType,
          name: fileName,
          size
        });
      } catch (error) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: finalKey })).catch(() => undefined);
        throw error;
      }

      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: deleteKeys, Quiet: true } })).catch(() => undefined);

      return json(request, {
        ok: true,
        publicUrl,
        contentType,
        size
      });
    } catch (error) {
      console.error('ADS media complete failed', error);
      return json(request, { error: error instanceof Error ? error.message : 'Could not complete upload' }, 500);
    }
  }

  return json(request, { error: 'Unknown action' }, 400);
}

export async function PUT(request: Request) {
  const origin = request.headers.get('origin');
  if (!allowedOrigin(origin)) return json(request, { error: 'Origin not allowed' }, 403);

  const authorization = bearer(request);
  if (!authorization) return json(request, { error: 'Login required' }, 401);

  const campaignId = cleanId(request.headers.get('x-campaign-id'));
  const uploadId = cleanUploadId(request.headers.get('x-upload-id'));
  const part = Number(request.headers.get('x-part-number') || 0);
  const contentType = (request.headers.get('content-type') || '').split(';')[0];
  const info = TYPE_INFO[contentType];

  if (!campaignId || !uploadId || !info || !Number.isInteger(part) || part < 1 || part > MAX_PARTS) {
    return json(request, { error: 'Invalid part request' }, 400);
  }
  if (!(await verifyCampaignOwner(campaignId, authorization))) {
    return json(request, { error: 'Campaign not found or not owned by this user' }, 403);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > CHUNK_BYTES) return json(request, { error: 'Chunk too large' }, 413);

  const bytes = Buffer.from(await request.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > CHUNK_BYTES) {
    return json(request, { error: 'Chunk too large or empty' }, 413);
  }

  const bucket = process.env.R2_BUCKET;
  if (!bucket) return json(request, { error: 'Storage is not configured' }, 500);

  try {
    await r2().send(new PutObjectCommand({
      Bucket: bucket,
      Key: tempKey(campaignId, uploadId, part),
      Body: bytes,
      ContentType: 'application/octet-stream',
      CacheControl: 'no-store'
    }));
    return json(request, { ok: true, part, bytes: bytes.byteLength });
  } catch (error) {
    console.error('ADS media part upload failed', error);
    return json(request, { error: 'Could not upload part' }, 500);
  }
}
