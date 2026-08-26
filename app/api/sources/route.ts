import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const sql = db();
    const rows = await sql`
      SELECT id, name, url, description, strengths, sort_order
      FROM design_sources
      ORDER BY sort_order ASC, name ASC
    `;
    return NextResponse.json(rows);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not load sources' }, { status: 500 });
  }
}
