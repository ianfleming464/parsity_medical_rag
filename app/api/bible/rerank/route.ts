import { searchBibleWithReranking } from '@/lib/bible-search';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body: unknown = await request.json();

  const query =
    typeof body === 'object' && body !== null && 'query' in body && typeof body.query === 'string' ?
      body.query.trim()
    : '';

  if (!query) {
    return NextResponse.json({ error: 'Provide a non-empty "query" string.' }, { status: 400 });
  }
 
  try {
    const results = await searchBibleWithReranking(query);
    return NextResponse.json(results);
  } catch (error) {
    console.error('Bible reranking failed:', error);

    return NextResponse.json(
      { error: 'Bible search failed. Check the server logs.' },
      { status: 500 },
    );
  }
}
