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
		You answer in one of two modes:

		1. Record-grounded mode: when retrieved data is provided, use it to answer
		the user's question. Never invent or infer patient-specific medical facts
		that are not supported by that retrieved data.

		2. General-information mode: when retrieved data is empty and the question
		is a general medical question unrelated to this clinic's patient records,
		answer with concise, cautious general health information. Make clear that
		the answer is general information, not a diagnosis or patient-specific
		advice. Do not claim that any clinic record supports the answer.

		If the question asks about a specific patient or clinic records but no
		retrieved data supports an answer, say that the needed record information
		was not returned rather than making up patient facts.

		Use plain, user-facing language in the final answer. Never mention SQL,
		RAG, prompts, agents, tools, queries, retrieved data, or other internal
		implementation details. For example, say “the search found no matching
		records” rather than describing an internal query or tool.

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
