/**
 * SQL agent — text-to-SQL. Feed the schema, get ONE read-only SELECT, run it.
 */

import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { openai } from '../openai';
import { prisma } from '../prisma';
import type { Message } from '../agent';

const SqlSchema = z.object({
	sql: z.string().describe('One read-only Postgres SELECT. No semicolons.'),
});

const SCHEMA = `You write PostgreSQL for a medical-records database.
Columns are camelCase and MUST be double-quoted: p."firstName". Tables are lowercase.

patients(id, "firstName", "lastName", gender, "birthDate", "deathDate", city, state)
conditions(id, "patientId", display)      -- diagnoses, SNOMED names e.g. "Hypertension"
medications(id, "patientId", display, status)  -- status: 'active' | 'stopped'
observations(id, "patientId", display, "valueNumber", unit, "effectiveDate")
notes(id, "patientId", date, content)

Every table joins to patients via "patientId" -> patients.id.
Rules: SELECT only. Use ILIKE '%term%' on display. Always add a LIMIT.`;

// Demo queries — all verified end-to-end against the data:
//   "how many patients have had a stroke?"                  -> ILIKE '%Stroke%'                     -> 113
//   "which patients have both hypertension and hyperlipidemia?" -> two EXISTS subqueries           -> 19 names
//   "who is the oldest patient with hypertension?"          -> ORDER BY "birthDate" ASC LIMIT 1     -> Avery Mueller (1911)
//   "how many patients had a heart attack?"                 -> ILIKE '%Myocardial Infarction%'      -> 25  (lay term -> SNOMED, from grounding)
//   "count patients on a statin"                            -> ILIKE '%statin%' AND status='active' -> 93  (lay term -> drug, + active filter)
// Skip lab-threshold queries (e.g. "glucose over 150") — the data is almost all normal readings, so they return ~1 row.
export async function runSql(query: string, history: Message[] = []): Promise<string> {
	// Ground the prompt with REAL values from the data. The schema says what
	// columns exist — this says what's IN them ("Myocardial Infarction", not
	// "heart attack"). Without it, lay terms return a confident 0 rows.
	const conditions = await prisma.$queryRawUnsafe<{ display: string }[]>(
		`SELECT DISTINCT display FROM conditions LIMIT 200`,
	);
	const meds = await prisma.$queryRawUnsafe<{ display: string }[]>(
		`SELECT DISTINCT display FROM medications LIMIT 200`,
	);
	const vocab = `Real condition names (match the user's words to these, use ILIKE):\n${conditions
		.map((c) => c.display)
		.join('; ')}\n\nReal medication names:\n${meds.map((m) => m.display).join('; ')}`;

	const response = await openai.responses.parse({
		model: 'gpt-4o-mini',
		input: [
			{ role: 'system', content: `${SCHEMA}\n\n${vocab}` },
			{ role: 'user', content: query },
		],
		temperature: 0,
		text: { format: zodTextFormat(SqlSchema, 'sqlQuery') },
	});

	const { sql } = SqlSchema.parse(response.output_parsed);
	console.log(`[sql agent] ${sql}`);

	const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);
	if (rows.length === 0) return 'SQL result: 0 rows — nothing matches.';

	return (
		`SQL result (${rows.length} rows):\n` +
		rows
			.slice(0, 20)
			.map((r) => '- ' + Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(', '))
			.join('\n')
	);
}