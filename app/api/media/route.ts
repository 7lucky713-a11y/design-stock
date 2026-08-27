import { NextRequest, NextResponse } from 'next/server';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { r2, r2PublicUrl } from '@/lib/r2';

const bucket = () => process.env.R2_MEDIA_BUCKET || process.env.R2_BUCKET;

export async function GET(req: NextRequest) {
  try {
    const Bucket = bucket();
    if (!Bucket) return NextResponse.json({ error: 'R2 bucket is not configured' }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const prefix = searchParams.get('prefix') || undefined;
    const cursor = searchParams.get('cursor') || undefined;

    const result = await r2().send(new ListObjectsV2Command({
      Bucket,
      Prefix: prefix,
      ContinuationToken: cursor,
      MaxKeys: 250,
    }));

    const items = (result.Contents || []).map((item) => ({
      key: item.Key || '',
      size: item.Size || 0,
      updatedAt: item.LastModified?.toISOString() || null,
      etag: item.ETag || null,
      url: item.Key ? r2PublicUrl(item.Key) : null,
    }));

    return NextResponse.json({
      bucket: Bucket,
      items,
      nextCursor: result.IsTruncated ? result.NextContinuationToken || null : null,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to load R2 media' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const Bucket = bucket();
    if (!Bucket) return NextResponse.json({ error: 'R2 bucket is not configured' }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const keys = Array.isArray(body?.keys) ? body.keys.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0) : [];
    if (!keys.length) return NextResponse.json({ error: 'No media selected' }, { status: 400 });
    if (keys.length > 1000) return NextResponse.json({ error: 'Too many objects selected' }, { status: 400 });

    const result = await r2().send(new DeleteObjectsCommand({
      Bucket,
      Delete: { Objects: keys.map((Key: string) => ({ Key })), Quiet: false },
    }));

    return NextResponse.json({
      deleted: result.Deleted?.map((x) => x.Key).filter(Boolean) || [],
      errors: result.Errors || [],
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete R2 media' }, { status: 500 });
  }
}
