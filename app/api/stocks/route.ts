import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const sql = db();
    const rows = await sql`
      SELECT id, title, url, memo, focus_note, tags, status, image_key, image_url, created_at, updated_at
      FROM design_stocks
      ORDER BY created_at DESC
    `;
    return NextResponse.json(rows);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not load stocks' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.url || !body.title) {
      return NextResponse.json({ error: 'title and url are required' }, { status: 400 });
    }

    const tags = Array.isArray(body.tags) ? body.tags.slice(0, 12) : [];
    const sql = db();
    const [row] = await sql`
      INSERT INTO design_stocks (title, url, memo, focus_note, tags, status, image_key, image_url)
      VALUES (
        ${body.title},
        ${body.url},
        ${body.memo ?? ''},
        ${body.focusNote ?? ''},
        ${tags},
        ${body.status ?? 'stock'},
        ${body.imageKey ?? null},
        ${body.imageUrl ?? null}
      )
      RETURNING id, title, url, memo, focus_note, tags, status, image_key, image_url, created_at, updated_at
    `;
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not save stock' }, { status: 500 });
  }
}
