# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A teaching codebase for a course on building a medical RAG system (see `docs/WHAT-WERE-BUILDING.md` and the README's 6-week curriculum). It ships as three branches with the same file layout but different completeness:

- `main` — the graded/reference implementation.
- `student` (**you are almost certainly on this one**) — core agent files are `TODO`-stubbed (`throw new Error('Not implemented — your turn!')`); students fill them in as challenges.
- `instructor` — instructor-only material.

**Before "fixing" a function that throws `Not implemented`, check whether it's an intentional student stub** (see the file list below) rather than a bug. Only implement it if the user is actively working that challenge; don't casually complete unrelated stubs as a drive-by.

## Commands

```bash
npm run dev              # Next.js dev server (turbopack), http://localhost:3000
npm run build             # production build
npm run lint               # next lint

npm run test              # vitest watch mode
npm run test:run           # vitest, single run (CI-style)
npx vitest run lib/pii.test.ts   # a single test file
npm run test:evals         # LLM-as-judge evals (lib/evals) — hits real OpenAI API, needs .env, excluded from test:run

npm run db:generate        # prisma generate (local codegen only — does NOT touch the DB)
npm run db:studio          # browse the (read-only) database

npm run vectorize          # rebuild the Pinecone index from Postgres notes
npm run similarity         # ad-hoc vector-search script
```

`db:push` exists but the shared class database is **read-only** for students — don't run it (it will fail).

Tests live next to the code they test (`*.test.ts`, e.g. `lib/pii.test.ts`, `app/api/schedule/route.test.ts`). `lib/evals/**` is excluded from the default vitest run (see `vitest.config.ts`) because it calls the real OpenAI API as an LLM judge; only runs under `test:evals`.

## Architecture

**Two data stores, one derived from the other:**
- **Neon PostgreSQL** (via Prisma, `prisma/schema.prisma`) — the system of record: `Patient`, `Condition`, `Observation`, `Medication`, `Encounter`, and `Note` (clinical notes — full text lives here too). Prisma client: `lib/prisma.ts`.
- **Pinecone** — a *derived* vector index over `Note` content only. Rebuildable from Postgres via `npm run vectorize` (`scripts/vectorize.ts`, `lib/pinecone.ts`). Never treat Pinecone as authoritative — if note content and the vector index disagree, Postgres wins and the index needs rebuilding.

**The chat pipeline** is one file per agent under `lib/agents/`, orchestrated by `app/api/chat/route.ts`:

```
app/api/chat/route.ts
  1. select(query, history)        lib/agents/selector.ts  — routes to SQL / vector / both / neither
  2. runSql(query) ‖ runRag(query) lib/agents/sql.ts, lib/agents/rag.ts  — run in parallel, each returns text
  3. aggregate({ sqlText, ragText }) lib/agents/aggregator.ts — the ONLY agent that streams; synthesizes one answer
```

- **Selector** just routes (needs SQL? needs vector search? neither = general question) — it does not extract entities/filters itself.
- **SQL agent is text-to-SQL, not a query builder.** It feeds the Postgres schema + real distinct-value grounding to the LLM, gets back `{ sql, explanation }`, and runs a single validated read-only `SELECT` via `prisma.$queryRawUnsafe`. **There is no hand-coded query-builder module (no `sql-queries.ts` / `CONDITION_MAPPINGS`) — don't recreate one.** If a query returns wrong/empty results, fix the schema prompt or grounding inside `lib/agents/sql.ts`, never add a per-question function.
  - Two guardrails matter here: **safety** (reject anything but one read-only `SELECT` — no DML/DDL/`;`; enforce a `LIMIT`) and **semantic grounding** (a column existing isn't the same as knowing what's in it — "smoker" ≠ the stored `"Smokes tobacco daily"`).
- **RAG agent** calls `searchClinicalNotes()` (`lib/vector-search.ts`) and renders results to text — no streaming.
- `lib/agent.ts` is now just the shared `Message` type; the old single-file `runAgent` orchestrator is gone.
- `lib/patients.ts` (`findPatientByName`) is the one hand-written exact-match query, kept because the scheduling flow needs a real `Patient` object, not free text — this is deliberately *not* folded into the text-to-SQL agent.

**Scheduling** (`lib/scheduling.ts`) is a human-in-the-loop flow: LLM detects scheduling intent → UI shows a confirmation form → only a human confirming books the appointment (`lib/calendar.ts`, Cal.com). `lib/retell.ts` / `scripts/retell/deploy-agent.ts` handle the outbound confirmation call (Retell voice agent).

**MCP server** (`mcp-server/index.ts`) is a *separate, front-office channel* — same repo, different trust boundary from the chat UI.

## PII obscuring — channel-based, not role-based

There's no login/roles system. Instead, obscuring is decided by *which channel* is answering:
- **MCP server** (front-office/staff tool) — **always** obscures. Every tool response must go through PII scrubbing before it leaves the server.
- **Chat channel** (clinician-facing, `app/api/chat/route.ts`) — returns full data, no obscuring.

Because the SQL agent's output shape depends on whatever columns the LLM chose, there's no fixed "name field" to redact — so obscuring runs the regex de-identifier (`obscureContent`, `lib/pii.ts`) over the **entire rendered output** of a channel, not field-by-field:

```typescript
const combined = [sqlText, ragText].filter(Boolean).join('\n\n');
const safe = obscureContent(combined); // scrub the whole rendered output
```

It's intentionally imperfect (regex misses novel formats) — that gap is the point of `docs/CHALLENGE-PII.md`. `obscurePatient()` still exists as a field-by-field helper but the main MCP path uses `obscureContent` on rendered text instead. Enable/inspect via `OBSCURE_PII=true` in `.env`; utilities are `obscureName`, `obscureDate`, `obscureLocation`, `obscureContent`, `shouldObscurePII` in `lib/pii.ts`.

## Prompt-injection defense (poisoned documents)

`lib/security/content-validator.ts` detects/sanitizes injection patterns (fake system-override markers, role impersonation, tool-call mimicry, data-exfiltration URLs, hidden-instruction blocks) in *retrieved* content before it reaches the LLM — this defends the RAG path specifically, since anyone who can get content into `Note`/Pinecone can try to inject instructions via retrieval. See `docs/CHALLENGE-POISONED-DOCS.md` and `scripts/security/demo-poisoned-docs.ts` for the attack/defense demo.

## OpenAI Structured Outputs with Zod

**Always use the Responses API pattern** for structured outputs — this is a hard project convention, not a suggestion:

```typescript
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';

const MySchema = z.object({
  field: z.string().describe('Description for the LLM'),
  count: z.number().describe('Numeric field'),
  category: z.enum(['a', 'b', 'c']).describe('Enum field'),
});
type MyType = z.infer<typeof MySchema>;

const response = await openai.responses.parse({
  model: 'gpt-4o-mini',
  input: [
    { role: 'system', content: 'System prompt here' },
    { role: 'user', content: userInput },
  ],
  temperature: 0,
  text: { format: zodTextFormat(MySchema, 'schemaName') },
});

const parsed = MySchema.parse(response.output_parsed);
```

`lib/openai.ts` is the single place that configures the OpenAI client(s): `openai` (raw SDK client, used for `responses.parse`) and `openaiProvider` (Vercel AI SDK provider, used for `streamText` in the aggregator only). Both honor `OPENAI_BASE_URL` if set — don't instantiate a second client elsewhere.

**DO NOT use the old beta API:** `zodResponseFormat` → `zodTextFormat`; `client.beta.chat.completions.parse()` → `client.responses.parse()`; `messages: [...]` → `input: [...]`; `response.choices[0].message.parsed` → `response.output_parsed`.

## API Route Input Validation

Parse request bodies with a Zod schema and let it throw — the route's catch-all maps `ZodError` to a 400:

```typescript
const MyRequestSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().default(10),
});

export async function POST(request: Request) {
  try {
    const { query, topK } = MyRequestSchema.parse(await request.json());
    // ... happy path only
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
```

Don't hand-roll `if (!query || typeof query !== "string")` checks, don't use `safeParse` + hand-built issue strings, and don't build responses with raw `new Response(JSON.stringify(...))` — use `NextResponse.json(body, { status })`.

## TypeScript Conventions

Prefer `type` aliases over `interface` for object shapes, props, and data models — `type` handles unions/intersections/primitives consistently and avoids declaration-merging surprises. Reach for `interface` only when you specifically need merging.

## Data source

Synthea Coherent Dataset — statistically realistic, fully synthetic (zero PHI). The shared class database is a ~200-patient subset, ~21k SOAP-style clinical notes, and is **read-only** for students (nobody creates or seeds it directly — `DATABASE_URL` points at a read-only role in production).
