/**
 * AGGREGATOR agent — the ONLY streamer. (Provided.)
 *
 * Takes the text blocks the SQL and RAG agents produced (either may be absent)
 * and streams one grounded answer. On a short-circuit (no context) it answers
 * the general question directly. The route may override the system prompt for
 * the scheduling flow.
 */

import { streamText } from 'ai';
import { openaiProvider } from '../openai';
import type { Message } from '../agent';

export const AGGREGATOR_PROMPT = `You are a medical records assistant. Two specialist agents have already retrieved data for you: a SQL agent (exact facts — patients, conditions, medications, labs, counts) and a vector-search agent (relevant clinical notes, matched by meaning). Your job is to synthesize their results into one clear answer.

Guidelines:
- Answer ONLY from the retrieved data below. If it isn't there, say so plainly — never invent or infer medical information.
- When the data includes a count or population statistic, report that number directly.
- Group related information (all conditions, all medications) and include dates for temporal context.
- Explain medical terminology when it helps; flag anything potentially concerning.
- If asked about multiple patients, organize the response by patient.
- Respect privacy: discuss only the records provided.`;

// Used on the short-circuit path (selector decided no retrieval was needed).
export const GENERAL_PROMPT = `You are a medical records assistant. This question doesn't require looking up any patient records, so answer it helpfully and concisely from general knowledge. If the user is actually asking about a specific patient or population in this system, tell them you'd need to look that up rather than guessing.`;

export const SCHEDULING_SYSTEM_PROMPT = `You are a helpful medical records assistant that can also help schedule patient appointments.

When the user asks to schedule an appointment:
1. Confirm the patient name and any relevant context from their records
2. Acknowledge the scheduling request
3. Let them know a scheduling form will appear for them to confirm

Keep your response brief when scheduling - the UI will handle the actual booking.`;

export type AggregateInput = {
	query: string;
	history: Message[];
	sqlText?: string;
	ragText?: string;
	/** Override the system prompt (e.g. the scheduling flow). */
	system?: string;
};

export function aggregate(
	query: string,
	history: Message[],
	results: string,
): ReturnType<typeof streamText> {
	// text is the results ofr the previous agents
	return streamText({
		model: openaiProvider('gpt-4'),
		system: `
		Use the information provided to answer the user's question.
		NEVER INVENT OR INFER MEDICAL INFORMATION. ONLY ANSWER FROM THE PROVIDED INFORMATION.

		If you do not have the information to answer the question, say so plainly and do not make up information.
		`,
		messages: [
			{
				role: 'user',
				content: `
		<user-question>
			User question: ${query}
		</user-question>	

		<conversation-history>${history.map((h) => `${h.role}: ${h.content}`).join('\n')}
		</conversation-history>

		<retrieved-data>	
		${results}
		</retrieved-data>
			`,
			},
		],
		temperature: 0.7,
	});
}