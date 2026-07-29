/**
 * SQL agent — text-to-SQL. Feed the schema, get ONE read-only SELECT, run it.
 */

import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { openai } from '../openai';
import { prisma } from '../prisma';
import type { Message } from '../agent';

const SqlSchema = z.object({
  sql: z.string().describe('One read-only Postgres SELECT. No semicolons. No LIMIT. NO DELETE'),
});

function formatSqlValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function formatSqlResult(
  query: string,
  sql: string,
  rows: Record<string, unknown>[],
): string {
  if (rows.length === 0) {
    return `SQL result for the user question "${query}": 0 rows — nothing matches.`;
  }

  return [
    `SQL matches for the user question: "${query}"`,
    'The rows below were returned by this executed filter:',
    sql,
    `Rows returned: ${rows.length} total (first ${Math.min(rows.length, 20)} shown).`,
    ...rows.slice(0, 20).map(
      row =>
        '- ' +
        Object.entries(row)
          .map(([key, value]) => `${key}: ${formatSqlValue(value)}`)
          .join(', '),
    ),
  ].join('\n');
}

const SCHEMA = `You write PostgreSQL for a medical-records database.
Columns are camelCase and MUST be double-quoted: p."firstName". Tables are lowercase.
patients(id, "firstName", "lastName", gender, "birthDate", "deathDate", city, state)
conditions(id, "patientId", display)      -- diagnoses, SNOMED names e.g. "Hypertension"
medications(id, "patientId", display, status)  -- status: 'active' | 'stopped'
observations(id, "patientId", display, "valueNumber", unit, "effectiveDate")
notes(id, "patientId", date, content)
Every table joins to patients via "patientId" -> patients.id.
Rules: SELECT only. Use ILIKE '%term%' on display. Always add a LIMIT.
For patient-list questions, order names by last name then first name and use
LIMIT 10 by default. If the user explicitly asks for more or specifies a
number, use that requested count up to a maximum LIMIT of 100.
When the user explicitly asks about “one of the patients”, “any patient”, or
a random patient, choose a real patient with ORDER BY RANDOM() LIMIT 1. Never
invent a patient ID or use a placeholder such as 'specific_patient_id'. For a
random health-history summary, choose the patient BEFORE retrieving related
records. Use this one-row CTE pattern, adapting field names only as needed:

WITH selected_patient AS (
  SELECT id, "firstName", "lastName", gender, "birthDate", "deathDate", city, state
  FROM patients
  ORDER BY RANDOM()
  LIMIT 1
)
SELECT
  p.*,
  (SELECT array_agg(DISTINCT display) FROM conditions WHERE "patientId" = p.id) AS conditions,
  (SELECT array_agg(DISTINCT display) FROM medications WHERE "patientId" = p.id) AS medications,
  (SELECT array_agg(DISTINCT display) FROM observations WHERE "patientId" = p.id) AS observations,
  (SELECT string_agg(content, E'\\n---\\n' ORDER BY date DESC)
   FROM (SELECT content, date FROM notes WHERE "patientId" = p.id ORDER BY date DESC LIMIT 5) recent_notes) AS recent_notes
FROM selected_patient p
LIMIT 1

Do not join conditions, medications, observations, and notes together before
random selection: that creates a huge cross-product and may time out. Do not
add a semicolon.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  DOCTOR
  STAFF
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  role         Role
  createdAt    DateTime @default(now())

  @@map("users")
}

model Patient {
  id            String    @id
  firstName     String?
  lastName      String?
  gender        String?
  birthDate     DateTime? @db.Date
  deathDate     DateTime? // null = alive (823/1280 Coherent patients have a death date)
  phone         String?
  maritalStatus String?
  race          String?
  ethnicity     String?
  city          String?
  state         String?

  conditions   Condition[]
  observations Observation[]
  medications  Medication[]
  encounters   Encounter[]
  notes        Note[]

  @@index([lastName, firstName])
  @@map("patients")
}

model Condition {
  id             String    @id
  patientId      String
  code           String? // SNOMED code
  display        String // e.g. "Type 2 Diabetes Mellitus"
  clinicalStatus String? // active | resolved | inactive
  onsetDate      DateTime?
  abatementDate  DateTime?

  patient Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)

  @@index([patientId])
  @@index([display])
  @@map("conditions")
}

model Observation {
  id            String    @id
  patientId     String
  code          String? // LOINC code
  display       String // e.g. "Hemoglobin A1c"
  category      String? // laboratory | vital-signs | survey | ...
  valueNumber   Float?
  valueString   String?
  unit          String?
  effectiveDate DateTime?

  patient Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)

  @@index([patientId])
  @@index([code])
  @@index([display])
  @@map("observations")
}

model Medication {
  id         String    @id
  patientId  String
  code       String? // RxNorm code
  display    String // e.g. "Simvastatin 10 MG Oral Tablet"
  status     String? // active | stopped | completed
  authoredOn DateTime?
  dosage     String?

  patient Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)

  @@index([patientId])
  @@index([display])
  @@map("medications")
}

// Clinical notes live here too: Postgres is the system of record for ALL data.
// Pinecone is a DERIVED index (note text + metadata) kept in sync from this table.
model Note {
  id        String    @id // DocumentReference id — also the vector id in Pinecone
  patientId String
  type      String? // e.g. "History and physical note"
  date      DateTime?
  content   String // the full note text (~450 chars avg); the source of truth

  patient Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)

  @@index([patientId])
  @@map("notes")
}

model Encounter {
  id              String    @id
  patientId       String
  classCode       String? // HL7 v3 ActCode: AMB (ambulatory) | EMER (emergency) | IMP (inpatient)
  type            String? // e.g. "Encounter for problem", "General examination of patient"
  status          String? // finished | in-progress | planned | cancelled
  startDate       DateTime?
  endDate         DateTime?
  serviceProvider String? // organization display, if present

  patient Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)

  @@index([patientId])
  @@index([classCode])
  @@map("encounters")
}

`;

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
    `SELECT DISTINCT display FROM conditions`,
  );
  const meds = await prisma.$queryRawUnsafe<{ display: string }[]>(
    `SELECT DISTINCT display FROM medications`,
  );
  const vocab = `Real condition names (match the user's words to these, use ILIKE):\n${conditions
    .map(c => c.display)
    .join('; ')}\n\nReal medication names:\n${meds.map(m => m.display).join('; ')}`;

  const response = await openai.responses.parse({
    model: 'gpt-4o-mini',
    input: [
      { role: 'system', content: ` ${SCHEMA}\n\n${vocab}` },
      {
        role: 'user',
        content: `User Query: ${query} \n\n Convo history: ${
          history.length > 0 ?
            history
              .slice(-5)
              .map(h => `${h.role}: ${h.content}`)
              .join('\n')
          : ''
        }`,
      },
    ],
    temperature: 0,
    text: { format: zodTextFormat(SqlSchema, 'sqlQuery') },
  });

  const { sql } = SqlSchema.parse(response.output_parsed);
  console.log(`[sql agent] ${sql}`);

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);
  return formatSqlResult(query, sql, rows);
}
