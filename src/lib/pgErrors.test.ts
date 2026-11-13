import { describe, expect, it } from 'vitest';
import { describeFailure, isSchemaDrift, isUniqueViolation, pgErrorCode } from './pgErrors';

describe('isUniqueViolation', () => {
  it('reads a bare driver error and a wrapped one', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(new Error('wrapped', { cause: { code: '23505' } }))).toBe(true);
  });

  it('is false for other codes and non-errors', () => {
    expect(isUniqueViolation({ code: '23514' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });

  it('matches a named constraint when the driver reports one', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'a_idx' }, 'a_idx')).toBe(true);
    expect(isUniqueViolation({ code: '23505', constraint: 'b_idx' }, 'a_idx')).toBe(false);
  });
});

describe('schema drift', () => {
  // The error production threw on 2026-11-13, as the postgres driver shapes it.
  const missingColumn = Object.assign(new Error('column "anon_id" of relation "usage_events" does not exist'), { name: 'PostgresError', code: '42703' });

  it('reads the SQLSTATE bare or wrapped, and not a node errno', () => {
    expect(pgErrorCode(missingColumn)).toBe('42703');
    expect(pgErrorCode(new Error('query failed', { cause: missingColumn }))).toBe('42703');
    expect(pgErrorCode(Object.assign(new Error('x'), { code: 'EPIPE' }))).toBeNull();
    expect(pgErrorCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBeNull();
    expect(pgErrorCode(null)).toBeNull();
  });

  it('a missing column, table or type is drift; a constraint violation is not', () => {
    expect(isSchemaDrift(missingColumn)).toBe(true);
    expect(isSchemaDrift({ code: '42P01' })).toBe(true);
    expect(isSchemaDrift({ code: '42704' })).toBe(true);
    expect(isSchemaDrift({ code: '23505' })).toBe(false);
    expect(isSchemaDrift(new Error('boom'))).toBe(false);
  });

  it('the log line names the column and says what to do', () => {
    const line = describeFailure(new Error('query failed', { cause: missingColumn }));
    expect(line).toMatch(/^SCHEMA DRIFT pg=42703 /);
    expect(line).toContain('query failed ← PostgresError: column "anon_id" of relation "usage_events" does not exist');
    expect(line).toContain('db:migrate');
    expect(line).toContain('/hotels/api/health');
    expect(describeFailure(missingColumn)).toContain('column "anon_id" of relation "usage_events" does not exist');
    expect(describeFailure({ code: '23505' } as unknown)).toBe('pg=23505 [object Object]');
    expect(describeFailure(new TypeError('x is undefined'))).toBe('TypeError: x is undefined');
  });
});
