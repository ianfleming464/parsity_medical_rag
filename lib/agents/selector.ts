/**
 * SELECTOR agent — YOUR TASK. Structured output only (never streams).
 *
 * The selector just ROUTES: does this question need the SQL database (structured
 * facts, counts, filters), the clinical notes (meaning-based search), both, or
 * neither (a general question)? It does NOT extract conditions/filters/entities —
 * the SQL agent's LLM does that when it writes the query. Keep it tiny.
 */

import { z } from 'zod';
import { openai } from '../openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { Message } from '../agent';
import { Prisma } from '@prisma/client';

// useSql: boolean;
// useRag: boolean;
// reason: string;
// agentQuery: string;

const planAgentSchema = z.object({
  useSql: z.boolean().describe('Whether to use the sql database which has structured data about patients'),
  useRag: z.boolean().describe('Whether to use the vector store which has infomration about patient notes BUT not structured data'),
  useScheduler: z.boolean().describe('Decide whether to schedule an appointment for the patient'),
  reason: z.string().describe('The reason for the decision to use the sql database or the vector store or NONE or to schedule an appointment'),
  agentQuery: z.string().describe('The optimized query to be sent to RAG agent - fix spelling and grammar errors').nullable(), // if useRag is true, this is the query to be sent to the RAG agent
  clarificationQuery: z
    .string()
    .describe('If the query is not clear, ask for clarification. You can only answer questions about medical information.')
    .nullable(),
});

export type Plan = {
  useSql: boolean;
  useRag: boolean;
  useScheduler: boolean;
  clarificationQuery: string | null;
  /** false = a general question with no tie to the records — answer directly. */
  needsSearch: boolean;
  semanticQuery: string;
};
// TODO: Write the system prompt. Describe the two stores (SQL DB of structured
// facts; vector store of clinical notes) and when each is needed. A pure general
// question (a greeting, "what's a normal A1C range?") needs NEITHER. When unsure,
// prefer searching the notes.

const SELECTOR_SYSTEM_PROMPT = `
  You are the routing agent for a medical-records assistant. You do not answer
  the user's question. You decide which data source, if any, should be used.

  Available sources:

  1. SQL database
  Use SQL for structured, exact patient data:
  - counts
  - diagnoses and conditions
  - medications
  - lab results and numeric values
  - dates
  - exact patient details
  - hard filters, such as “patients with hypertension”

  2. RAG / vector search over clinical notes
  Use RAG for free-text clinical narrative and meaning-based questions:
  - symptoms described in notes
  - clinician observations
  - patient stories or visit context
  - wording/synonym questions, such as “breathing trouble” versus “dyspnea”
  - questions asking what notes say

  3. Both SQL and RAG
  Use both when a question needs structured facts and clinical-note narrative.
  Example: “Summarize Abe Frami’s health history” needs SQL for conditions,
  medications, labs, and dates, plus RAG for clinical-note context.

  4. Scheduler
  Use the scheduler only when the user clearly asks to schedule, book, arrange,
  or move an appointment. Do not use SQL or RAG merely because a scheduling
  request mentions a patient.

  Important rules:
  - Never invent a patient name, patient ID, condition, date, or filter.
  - “One of the patients”, “any patient”, or an explicit request for a random
    patient authorizes a random selection. For that current workflow, use SQL
    only and set useRag to false; SQL will choose one real patient.
  - If a request needs a specific patient but does not identify one, do not
    choose SQL or RAG. Set both to false and provide a clarification question.
    This rule does not apply when the user explicitly authorizes a random
    patient with wording such as “one of the patients”.
  - For general medical questions unrelated to this clinic’s patient records,
    set useSql and useRag to false. Do not redirect or invent records.
  - Use agentQuery only when useRag is true. It must be a short, natural-language
    semantic search query, never SQL or code.
  - If useRag is false, set agentQuery to null.
  - If no clarification is needed, set clarificationQuery to null.
  - Return a decision that matches the schema exactly.
  `;

export async function select(query: string, history: Message[] = []): Promise<Plan> {
  //query -> decide what to do?

  // query vector or query sql OR BOTH
  //CONTEXT:
  // we have notes on patiens in a vector store including....
  // we have structured data on patients in a sql database including .....
  // sql schema / types

  // choose 1 or both or none

  const answer = await openai.responses.parse({
    model: 'gpt-4o-mini',
    text: { format: zodTextFormat(planAgentSchema, 'plan') },
		input: [
		  {
      role: 'system',
      content: SELECTOR_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `
				Convo history:${
          history.length > 0 ?
            history
              .slice(-5)
              .map(h => `${h.role}: ${h.content}`)
              .join('\n')
          : ''
        } 

				\n\n User Query: ${query}`,
      }, // the query from the user
    ],
    temperature: 0.5,
  });

  console.log(answer.output_parsed);

  // Map the parsed answer onto the Plan the route expects.
  const p = planAgentSchema.parse(answer.output_parsed);
  return {
    useSql: p.useSql,
    useRag: p.useRag,
    useScheduler: p.useScheduler,
    clarificationQuery: p.clarificationQuery,
    needsSearch: p.useSql || p.useRag,
    semanticQuery: p.agentQuery ?? query,
  };
}
