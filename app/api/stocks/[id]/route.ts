import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const sql = db();
    const [row] = await sql`
      UPDATE design_stocks
      SET
        title = COALESCE(${body.title ?? null}, title),
        url = COALESCE(${body.url ?? null}, url),
        memo = COALESCE(${body.memo ?? null}, memo),
        focus_note = COALESCE(${body.focusNote ?? null}, focus_note),
        tags = COALESCE(${Array.isArray(body.tags) ? body.tags : null}, tags),
        status = COALESCE(${body.status ?? null}, status),
        image_key = COALESCE(${body.imageKey ?? null}, image_key),
        image_url = COALESCE(${body.imageUrl ?? null}, image_url),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, title, url, memo, focus_note, tags, status, image_key, image_url, created_at, updated_at
    `;
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not update stock' }, { status: 500 });
  }
}

export async function DELETE(_: Request, context: Context) {
  try {
    const { id } = await context.params;
    const sql = db();
    await sql`DELETE FROM design_stocks WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not delete stock' }, { status: 500 });
  }
}
