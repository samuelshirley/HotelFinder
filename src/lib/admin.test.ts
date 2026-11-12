import { describe, expect, it } from 'vitest';

import { adminEmails, isAdminEmail } from './admin';

describe('admin emails', () => {
  it('nobody is an admin when ADMIN_EMAILS is unset or blank', () => {
    expect(isAdminEmail('sam@feraltravels.com', {})).toBe(false);
    expect(isAdminEmail('sam@feraltravels.com', { ADMIN_EMAILS: ' , ' })).toBe(false);
    expect(adminEmails({ ADMIN_EMAILS: '' }).size).toBe(0);
  });

  it('matches listed emails case- and space-insensitively, and nothing else', () => {
    const env = { ADMIN_EMAILS: ' Sam@FeralTravels.com , other@x.test' };
    expect(isAdminEmail('sam@feraltravels.com', env)).toBe(true);
    expect(isAdminEmail(' OTHER@x.test ', env)).toBe(true);
    expect(isAdminEmail('sam@feraltravels.co', env)).toBe(false);
    expect(isAdminEmail('', env)).toBe(false);
    expect(isAdminEmail(null, env)).toBe(false);
  });
});
