/**
 * RAG agent — YOUR TASK. Returns TEXT (never streams).
 *
 * Meaning-based search over the clinical notes, rendered into a context block
 * for the aggregator.
 */

import { searchClinicalNotes } from '../vector-search';

export type RagResult = {
  context: string;
  patientIds: string[];
};

export async function runRag(
  semanticQuery: string,
  options: { excludePatientIds?: string[] } = {},
): Promise<RagResult> {
  const notes = await searchClinicalNotes(semanticQuery, {
    topK: 20,
    excludePatientIds: options.excludePatientIds,
  });

  console.log('notes', notes);
  const patientIds = [...new Set(
    notes.rerankedDocuments
      .map(note => notes.docs[note.index]?.metadata?.patientId)
      .filter((patientId): patientId is string => typeof patientId === 'string'),
  )];

  return {
    context: notes.rerankedDocuments.map(note => `${JSON.stringify(note.document)}`).join(`\n\n`),
    patientIds,
  };
}
