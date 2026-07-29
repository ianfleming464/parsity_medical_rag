import { describe, expect, it, vi } from 'vitest';

vi.mock('../openai', () => ({ openai: {} }));
vi.mock('../prisma', () => ({ prisma: {} }));

import { formatSqlResult } from './sql';

describe('formatSqlResult', () => {
  it('keeps the question and SQL filter attached to matching rows', () => {
    const result = formatSqlResult(
      'Which patients had a stroke?',
      `SELECT p."firstName" FROM patients p WHERE p."condition" ILIKE '%stroke%' LIMIT 100`,
      [{ firstName: 'Abe', lastName: 'Frami' }],
    );

    expect(result).toContain('SQL matches for the user question: "Which patients had a stroke?"');
    expect(result).toContain("ILIKE '%stroke%'");
    expect(result).toContain('Rows returned: 1 total (first 1 shown).');
    expect(result).toContain('firstName: Abe, lastName: Frami');
  });

  it('labels an empty result with the user question', () => {
    expect(formatSqlResult('Which patients had a stroke?', 'SELECT 1', [])).toBe(
      'SQL result for the user question "Which patients had a stroke?": 0 rows — nothing matches.',
    );
  });

  it('renders aggregated SQL values as readable JSON instead of [object Object]', () => {
    const result = formatSqlResult('Summarize one patient.', 'SELECT 1', [
      { conditions: ['Hypertension'], recentNotes: { count: 5 } },
    ]);

    expect(result).toContain('conditions: ["Hypertension"]');
    expect(result).toContain('recentNotes: {"count":5}');
  });
});
