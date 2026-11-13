import { describe, expect, it } from 'vitest';
import { ERROR_COPY, withRef } from './errors';

describe('withRef', () => {
  it('appends the server reference, or leaves the copy alone without one', () => {
    expect(withRef(ERROR_COPY.server_error, 'a1b2c3d4')).toBe(`${ERROR_COPY.server_error} (Reference: a1b2c3d4)`);
    expect(withRef(ERROR_COPY.server_error, null)).toBe(ERROR_COPY.server_error);
    expect(withRef(ERROR_COPY.server_error, undefined)).toBe(ERROR_COPY.server_error);
  });
});
