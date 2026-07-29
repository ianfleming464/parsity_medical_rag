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
		A non-empty SQL result is authoritative evidence. Never claim information is missing if SQL rows are present. For “which patients” questions, list the patient names from the rows. When the SQL evidence is a bounded patient list, state that these are the matching patients returned by this search and offer to look up more if the user needs them. Do not claim the returned page is every matching patient unless the evidence explicitly says so.
		`,
		messages: [
			{
				role: 'user',
				content: `
					<user-question>
						Original user query: ${query}
					</user-question>	

					<conversation-history>${history.map((h) => `${h.role}: ${h.content}`).join('\n')}
					</conversation-history>

					<retrieved-data>	
					${results}
					</retrieved-data>
			`,
			},
		],
		temperature: 0,
	});
}
