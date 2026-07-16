import 'dotenv/config';
import { createEmbedding } from '../../lib/openai';
import { INDEX_NAME, pinecone } from '../../lib/pinecone';

const TOP_K = 5;

function getQuery(args: string[]): string {
  const query = args.join(' ').trim();

  if (!query) {
    throw new Error(
      'Usage: npm run bible:query -- [--full] <natural-language query>',
    );
  }

  return query;
}

async function main() {
  if (INDEX_NAME !== 'bible-kjv') {
    throw new Error(`Refusing to query "${INDEX_NAME}". Set PINECONE_INDEX=bible-kjv.`);
  }

  const args = process.argv.slice(2);
  const showFullText = args.includes('--full');
  const query = getQuery(args.filter((arg) => arg !== '--full'));
  const vector = await createEmbedding(query);

  const results = await pinecone.Index(INDEX_NAME).query({
    vector,
    topK: TOP_K,
    includeMetadata: true,
  });

  console.log(`\nQuery: "${query}"\n`);

  for (const match of results.matches) {
    const reference =
      typeof match.metadata?.reference === 'string' ?
        match.metadata.reference
      : 'Unknown reference';
    const content = typeof match.metadata?.content === 'string' ? match.metadata.content : '';

    console.log(
      `${match.score?.toFixed(3) ?? 'n/a'}  ${reference} (${match.id})`,
    );
    const normalizedContent = content.replace(/\s+/g, ' ');
    const displayedContent =
      showFullText || normalizedContent.length <= 300
        ? normalizedContent
        : `${normalizedContent.slice(0, 300)}...`;

    console.log(`  ${displayedContent}\n`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});


// PINECONE_INDEX=bible-kjv npm run bible:query -- --full "Should I get even with someone who has hurt me?"