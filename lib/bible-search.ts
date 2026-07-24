import { createEmbedding } from './openai';
  import { pinecone } from './pinecone';

  const INDEX_NAME = 'bible-kjv'; 
  const RETRIEVAL_TOP_K = 25; // Retrieve the top 25 
  const RERANK_TOP_N = 5; // Re-rnk the top 5
  const RERANK_MODEL = 'bge-reranker-v2-m3'; 

  type BibleCandidate = {
    id: string;
    reference: string;
    content: string;
    vectorScore: number;
    vectorRank: number;
  };

  type RerankedBibleCandidate = BibleCandidate & {
    rerankerScore: number;
  };

  export type BibleRerankSearchResult = {
    query: string;
    retrievedCandidates: BibleCandidate[];
    rerankedTopFive: RerankedBibleCandidate[];
  };

  export async function searchBibleWithReranking(query: string): Promise<BibleRerankSearchResult> {
    // 1. Embed the new user query
    const vector = await createEmbedding(query);

    // 2. Retrieve 25 stored chunks
    const response = await pinecone.Index(INDEX_NAME).query({
      vector,
      topK: RETRIEVAL_TOP_K,
      includeMetadata: true,
    });

    // 3. Convert raw Pinecone matches into display-safe Bible candidates.
    const retrievedCandidates: BibleCandidate[] = response.matches.map((match, index) => ({
      id: match.id,
      reference:
        typeof match.metadata?.reference === 'string'
          ? match.metadata.reference
          : 'Unknown reference',
      content: typeof match.metadata?.content === 'string' ? match.metadata.content : '',
      vectorScore: match.score ?? 0,
      vectorRank: index + 1,
    }));
    // Preserve original vector rank: index + 1.

    // 4. Send only those candidates’ text to the reranker.
    const reranked = await pinecone.inference.rerank(
      RERANK_MODEL,
      query,
      retrievedCandidates.map(candidate => candidate.content),
      {
        topN: RERANK_TOP_N,
        returnDocuments: false,
      },
    );

    // 5. `ranked.index` points back into retrievedCandidates.
    const rerankedTopFive: RerankedBibleCandidate[] = [];
    for (const ranked of reranked.data) {
      rerankedTopFive.push({
        ...retrievedCandidates[ranked.index],
        rerankerScore: ranked.score,
      });
    }

    return {
      query,
      retrievedCandidates,
      rerankedTopFive,
    };
  }
