import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand
} from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { r2, r2PublicUrl } from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADS_DATA_API = 'https://ep-damp-resonance-awphji1s.apirest.c-12.us-east-1.aws.neon.tech/neondb/rest/v1';
const IMAGE_MAX = 3 * 1024 * 1024;
const VIDEO_MAX = 10 * 1024 * 1024;
const ACCOUNT_MAX = 200 * 1024 * 1024;
const DAILY_UPLOAD_LIMIT = 20;
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
const CHUNK_BYTES = 2_500_000;
const MAX_PARTS = 5;
const MAX_OWNER_CAMPAIGNS_FOR_CLEANUP = 200;

const TYPE_INFO: Record<string, { max: number; ext: string }> = {
  'image/jpeg': { max: IMAGE_MAX, ext: 'jpg' },
  'image/png': { max: IMAGE_MAX, ext: 'png' },
  'image/webp': { max: IMAGE_MAX, ext: 'webp' },
  'video/mp4': { max: VIDEO_MAX, ext: 'mp4' },
  'video/webm': { max: VIDEO_MAX, ext: 'webm' }
};

type CampaignRow = {
  id: string;
  owner_user_id: string | null;
  media_url: string | null;
  media_size: number | string | null;
  status?: string | null;
  updated_at?: string | null;
};

type UploadReservation = {
  campaignId: string;
  contentType: string;
  size: number;
  createdAt: string;
};

function allowedOrigin(origin: string | null) {
  if (!origin) return true;
  if (origin === 'https://harfway-playback.vercel.app') return true;
  if (origin === 'https://harfway-ads-prototype.vercel.app') return true;
  if (origin === 'https://design-stock.vercel.app') return true;
  if (origin === 'https://design-stock-nu.vercel.app') return true;
  if (/^https:\/\/design-stock-[a-z0-9-]+-harf-way\.vercel\.app$/i.test(origin)) return true;
  return /^https:\/\/harfway-playback-[a-z0-9-]+-harf-way\.vercel\.app$/i.test(origin);
}

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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

function ownerHash(ownerUserId: string) {
  return createHash('sha256').update(ownerUserId).digest('hex').slice(0, 32);
}

function openReservationKey(ownerUserId: string, uploadId: string) {
  return `harfway-ads/guard/${ownerHash(ownerUserId)}/open/${uploadId}.json`;
}

function dailyReservationPrefix(ownerUserId: string, date = new Date().toISOString().slice(0, 10)) {
  return `harfway-ads/guard/${ownerHash(ownerUserId)}/daily/${date}/`;
}

function dailyReservationKey(ownerUserId: string, uploadId: string, date = new Date().toISOString().slice(0, 10)) {
  return `${dailyReservationPrefix(ownerUserId, date)}${Date.now()}-${uploadId}.json`;
}

function finalKey(campaignId: string, uploadId: string, ext: string) {
  return `harfway-ads/${new Date().toISOString().slice(0, 10)}/${campaignId}/${uploadId}.${ext}`;
}

function mediaKeyFromPublicUrl(value: string | null | undefined) {
  const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, '');
  const url = String(value || '');
  if (!base || !url.startsWith(`${base}/`)) return '';
  const key = url.slice(base.length + 1);
  if (!key.startsWith('harfway-ads/') || key.startsWith('harfway-ads/tmp/') || key.startsWith('harfway-ads/guard/')) return '';
  return key;
}

async function getCampaign(campaignId: string, authorization: string): Promise<CampaignRow | null> {
  if (!authorization) return null;
  const url = `${ADS_DATA_API}/ad_campaigns?id=eq.${encodeURIComponent(campaignId)}&select=id,owner_user_id,media_url,media_size,status,updated_at&limit=1`;
  const res = await fetch(url, {
    headers: { Authorization: authorization, Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length === 1 ? rows[0] as CampaignRow : null;
}

async function listOwnerCampaigns(ownerUserId: string, authorization: string): Promise<CampaignRow[]> {
  const url = `${ADS_DATA_API}/ad_campaigns?owner_user_id=eq.${encodeURIComponent(ownerUserId)}&select=id,owner_user_id,media_url,media_size,status,updated_at&limit=500`;
  const res = await fetch(url, {
    headers: { Authorization: authorization, Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`Could not verify storage usage (${res.status})`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows as CampaignRow[] : [];
}

function bytes(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function usageFor(campaign: CampaignRow, ownerCampaigns: CampaignRow[], nextSize: number) {
  const currentBytes = ownerCampaigns.reduce((sum, row) => sum + bytes(row.media_size), 0);
  const replacingBytes = bytes(campaign.media_size);
  const projectedBytes = Math.max(0, currentBytes - replacingBytes + nextSize);
  return { currentBytes, replacingBytes, projectedBytes, maxBytes: ACCOUNT_MAX };
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

async function readReservation(client: ReturnType<typeof r2>, bucket: string, ownerUserId: string, uploadId: string) {
  try {
    const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: openReservationKey(ownerUserId, uploadId) }));
    if (!obj.Body) return null;
    const text = await obj.Body.transformToString();
    const value = JSON.parse(text || '{}');
    if (!value || typeof value !== 'object') return null;
    return value as UploadReservation;
  } catch {
    return null;
  }
}

async function createReservation(
  client: ReturnType<typeof r2>,
  bucket: string,
  ownerUserId: string,
  uploadId: string,
  reservation: UploadReservation
) {
  const body = JSON.stringify(reservation);
  const dailyKey = dailyReservationKey(ownerUserId, uploadId);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: openReservationKey(ownerUserId, uploadId),
    Body: body,
    ContentType: 'application/json',
    CacheControl: 'no-store'
  }));
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: dailyKey,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'no-store'
    }));
  } catch (error) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: openReservationKey(ownerUserId, uploadId) })).catch(() => undefined);
    throw error;
  }
}

async function countDailyReservations(client: ReturnType<typeof r2>, bucket: string, ownerUserId: string) {
  const listed = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: dailyReservationPrefix(ownerUserId),
    MaxKeys: DAILY_UPLOAD_LIMIT + 1
  }));
  return listed.Contents?.length || 0;
}

async function deleteKeys(client: ReturnType<typeof r2>, bucket: string, keys: string[]) {
  if (!keys.length) return 0;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch, Quiet: true } }));
    deleted += batch.length;
  }
  return deleted;
}

async function cleanupStaleUploads(
  client: ReturnType<typeof r2>,
  bucket: string,
  ownerUserId: string,
  ownerCampaigns: CampaignRow[]
) {
  const cutoff = Date.now() - STALE_UPLOAD_MS;
  const stale: string[] = [];

  const open = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: `harfway-ads/guard/${ownerHash(ownerUserId)}/open/`,
    MaxKeys: 1000
  }));
  for (const item of open.Contents || []) {
    if (item.Key && item.LastModified && item.LastModified.getTime() < cutoff) stale.push(item.Key);
  }

  for (const campaign of ownerCampaigns.slice(0, MAX_OWNER_CAMPAIGNS_FOR_CLEANUP)) {
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `harfway-ads/tmp/${campaign.id}/`,
      MaxKeys: 1000
    }));
    for (const item of listed.Contents || []) {
      if (item.Key && item.LastModified && item.LastModified.getTime() < cutoff) stale.push(item.Key);
    }
  }

  return deleteKeys(client, bucket, stale);
}

async function removeReservation(client: ReturnType<typeof r2>, bucket: string, ownerUserId: string, uploadId: string) {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: openReservationKey(ownerUserId, uploadId) })).catch(() => undefined);
}

function reservationMatches(reservation: UploadReservation | null, campaignId: string, contentType: string, size?: number) {
  if (!reservation) return false;
  if (reservation.campaignId !== campaignId || reservation.contentType !== contentType) return false;
  if (size !== undefined && reservation.size !== size) return false;
  const created = Date.parse(reservation.createdAt);
  return Number.isFinite(created) && Date.now() - created <= STALE_UPLOAD_MS;
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  if (!allowedOrigin(origin)) return json(request, { error: 'Origin not allowed' }, 403);
  return json(request, {
    ok: true,
    storageGuard: 'ads-storage-guard-v1',
    policy: {
      imageMaxBytes: IMAGE_MAX,
      videoMaxBytes: VIDEO_MAX,
      accountMaxBytes: ACCOUNT_MAX,
      dailyUploadStarts: DAILY_UPLOAD_LIMIT,
      staleUploadHours: STALE_UPLOAD_MS / 3600000,
      oneCurrentAssetPerCampaign: true,
      replacementDeletesPreviousR2Object: true,
      putRequiresServerReservation: true
    }
  });
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
  const campaign = campaignId ? await getCampaign(campaignId, authorization) : null;
  if (!campaign || !campaign.owner_user_id) {
    return json(request, { error: 'Campaign not found or not owned by this user' }, 403);
  }

  if (action === 'start') {
    const contentType = String((body as any).contentType || '');
    const size = Number((body as any).size || 0);
    const info = TYPE_INFO[contentType];
    if (!info) return json(request, { error: 'Unsupported media type' }, 400);
    if (!Number.isInteger(size) || size <= 0 || size > info.max) {
      const label = contentType.startsWith('video/') ? '動画は10MBまでです。' : '画像は3MBまでです。';
      return json(request, { error: label }, 413);
    }

    const bucket = process.env.R2_BUCKET;
    if (!bucket) return json(request, { error: 'Storage is not configured' }, 500);

    try {
      const ownerCampaigns = await listOwnerCampaigns(campaign.owner_user_id, authorization);
      const usage = usageFor(campaign, ownerCampaigns, size);
      if (usage.projectedBytes > ACCOUNT_MAX) {
        return json(request, {
          error: '広告素材の保存上限（1アカウント200MB）を超えます。不要な素材を整理してから再度お試しください。',
          code: 'ACCOUNT_STORAGE_LIMIT',
          usage
        }, 413);
      }

      const client = r2();
      const cleanedStaleObjects = await cleanupStaleUploads(client, bucket, campaign.owner_user_id, ownerCampaigns).catch((error) => {
        console.warn('ADS stale upload cleanup skipped', error);
        return 0;
      });
      const dailyStarts = await countDailyReservations(client, bucket, campaign.owner_user_id);
      if (dailyStarts >= DAILY_UPLOAD_LIMIT) {
        return json(request, {
          error: '本日の広告素材アップロード上限（20回）に達しました。明日もう一度お試しください。',
          code: 'DAILY_UPLOAD_LIMIT',
          dailyStarts,
          dailyLimit: DAILY_UPLOAD_LIMIT
        }, 429);
      }

      const uploadId = crypto.randomUUID();
      await createReservation(client, bucket, campaign.owner_user_id, uploadId, {
        campaignId,
        contentType,
        size,
        createdAt: new Date().toISOString()
      });

      return json(request, {
        uploadId,
        chunkBytes: CHUNK_BYTES,
        maxBytes: info.max,
        storageGuard: 'ads-storage-guard-v1',
        usage,
        dailyStarts: dailyStarts + 1,
        dailyLimit: DAILY_UPLOAD_LIMIT,
        cleanedStaleObjects
      });
    } catch (error) {
      console.error('ADS media start guard failed', error);
      return json(request, { error: error instanceof Error ? error.message : 'Could not start upload' }, 500);
    }
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
    const reservation = await readReservation(client, bucket, campaign.owner_user_id, uploadId);
    if (!reservationMatches(reservation, campaignId, contentType, size)) {
      return json(request, { error: 'Upload session is missing, expired, or does not match this file', code: 'UPLOAD_SESSION_INVALID' }, 409);
    }
    const expectedParts = Math.ceil(size / CHUNK_BYTES);
    if (parts !== expectedParts) return json(request, { error: 'Invalid part count for reserved upload' }, 400);

    try {
      const ownerCampaigns = await listOwnerCampaigns(campaign.owner_user_id, authorization);
      const usage = usageFor(campaign, ownerCampaigns, size);
      if (usage.projectedBytes > ACCOUNT_MAX) {
        return json(request, {
          error: '広告素材の保存上限（1アカウント200MB）を超えます。',
          code: 'ACCOUNT_STORAGE_LIMIT',
          usage
        }, 413);
      }

      const buffers: Buffer[] = [];
      const deleteTempKeys: { Key: string }[] = [];
      let total = 0;

      for (let part = 1; part <= parts; part += 1) {
        const key = tempKey(campaignId, uploadId, part);
        const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!obj.Body) throw new Error(`Missing upload part ${part}`);
        const partBytes = await obj.Body.transformToByteArray();
        const buffer = Buffer.from(partBytes);
        total += buffer.byteLength;
        if (total > info.max) throw new Error('Upload exceeds allowed size');
        buffers.push(buffer);
        deleteTempKeys.push({ Key: key });
      }
      if (total !== size) throw new Error('Uploaded size does not match the selected file');

      const key = finalKey(campaignId, uploadId, info.ext);
      const publicUrl = r2PublicUrl(key);
      if (!publicUrl) throw new Error('R2 public URL is not configured');
      const previousKey = mediaKeyFromPublicUrl(campaign.media_url);

      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
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
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
        throw error;
      }

      let previousMediaDeleted = false;
      if (previousKey && previousKey !== key) {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: previousKey }));
          previousMediaDeleted = true;
        } catch (error) {
          console.warn('ADS previous media delete failed', { campaignId, previousKey, error });
        }
      }

      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: deleteTempKeys, Quiet: true } })).catch(() => undefined);
      await removeReservation(client, bucket, campaign.owner_user_id, uploadId);

      return json(request, {
        ok: true,
        publicUrl,
        contentType,
        size,
        storageGuard: 'ads-storage-guard-v1',
        previousMediaDeleted: previousKey ? previousMediaDeleted : null,
        oneCurrentAssetPerCampaign: true,
        usage
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

  const campaign = await getCampaign(campaignId, authorization);
  if (!campaign || !campaign.owner_user_id) {
    return json(request, { error: 'Campaign not found or not owned by this user' }, 403);
  }

  const bucket = process.env.R2_BUCKET;
  if (!bucket) return json(request, { error: 'Storage is not configured' }, 500);
  const client = r2();
  const reservation = await readReservation(client, bucket, campaign.owner_user_id, uploadId);
  if (!reservationMatches(reservation, campaignId, contentType)) {
    return json(request, { error: 'Upload session is missing or expired. Start the upload again.', code: 'UPLOAD_SESSION_INVALID' }, 409);
  }
  const expectedParts = Math.ceil(reservation!.size / CHUNK_BYTES);
  if (part > expectedParts) return json(request, { error: 'Unexpected upload part' }, 400);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > CHUNK_BYTES) return json(request, { error: 'Chunk too large' }, 413);

  const partBytes = Buffer.from(await request.arrayBuffer());
  if (!partBytes.byteLength || partBytes.byteLength > CHUNK_BYTES) {
    return json(request, { error: 'Chunk too large or empty' }, 413);
  }

  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: tempKey(campaignId, uploadId, part),
      Body: partBytes,
      ContentType: 'application/octet-stream',
      CacheControl: 'no-store'
    }));
    return json(request, { ok: true, part, bytes: partBytes.byteLength, storageGuard: 'ads-storage-guard-v1' });
  } catch (error) {
    console.error('ADS media part upload failed', error);
    return json(request, { error: 'Could not upload part' }, 500);
  }
}
