import { DrizzleQueryError } from 'drizzle-orm/errors';
import type { FastifyError } from 'fastify';
import { describe, expect, it } from 'vitest';
import { serializeError, serializeRequest } from '../http/redact.js';
import { parseAllowlist } from './allowlist.js';
import { csrfTokenFor, csrfTokenMatches } from './csrf.js';
import { identityFromClaims, LoginRejected } from './oidc.js';

describe('csrf', () => {
  it('a token a session-tokenhez kötött, determinisztikus, és időzítés-biztosan hasonlít', () => {
    const a = csrfTokenFor('A'.repeat(43));
    expect(csrfTokenFor('A'.repeat(43))).toBe(a);
    expect(csrfTokenFor('B'.repeat(43))).not.toBe(a);
    expect(csrfTokenMatches(a, a)).toBe(true);
    expect(csrfTokenMatches(a, `${a}x`)).toBe(false);
    expect(csrfTokenMatches(a, undefined)).toBe(false);
    expect(csrfTokenMatches(a, [a])).toBe(false);
  });
});

describe('identityFromClaims', () => {
  const base = {
    sub: 'abc',
    email: 'Anna.Nagy@Example.TEST',
    email_verified: true,
    name: ' Anna ',
  };

  it('csak megerősített e-mailt fogad el, kisbetűsítve', () => {
    expect(identityFromClaims(base)).toEqual({
      sub: 'abc',
      email: 'anna.nagy@example.test',
      name: 'Anna',
      picture: null,
    });
  });

  it.each([false, 'true', undefined, 1])('email_verified=%s elutasítva', (value) => {
    expect(() => identityFromClaims({ ...base, email_verified: value })).toThrow(LoginRejected);
  });

  it('e-mail vagy sub nélkül elutasít', () => {
    expect(() => identityFromClaims({ ...base, email: undefined })).toThrow(LoginRejected);
    expect(() => identityFromClaims({ ...base, sub: '' })).toThrow(LoginRejected);
  });
});

describe('parseAllowlist', () => {
  it('soronként egy e-mail, megjegyzések, kisbetűsítés, duplikátum-összevonás, CRLF és BOM', () => {
    const text =
      '﻿# bevezető\r\nAnna@Example.test  # tulajdonos\r\n\r\nbela@example.test\nanna@example.test\n';
    expect(parseAllowlist(text)).toEqual(['anna@example.test', 'bela@example.test']);
  });

  it('érvénytelen sornál a sor számát jelzi, az értéket nem', () => {
    expect(() => parseAllowlist('a@b.hu\nnem-email\n')).toThrow('2. sorában');
    expect(() => parseAllowlist('a@b.hu\nnem-email\n')).not.toThrow('nem-email');
  });
});

describe('naplóredakció (appsec F-8)', () => {
  it('a Drizzle-hiba sem a lekérdezést, sem a paramétereket, sem a stack-et nem viszi a naplóba', () => {
    const cause = Object.assign(new Error('duplicate key value (anna@example.test)'), {
      code: '23505',
    });
    const error = new DrizzleQueryError(
      'insert into users (email) values ($1)',
      ['anna@example.test'],
      cause,
    ) as unknown as FastifyError;
    const json = JSON.stringify(serializeError(error));
    expect(json).not.toContain('anna@example.test');
    expect(json).not.toContain('insert into');
    expect(json).toContain('DatabaseError');
  });

  it('a nem adatbázis-hiba érintetlen marad', () => {
    expect(serializeError(new Error('valami') as FastifyError)).toMatchObject({
      type: 'Error',
      message: 'valami',
    });
  });

  it('az /auth/ URL query-stringje (code, state) nem kerül a naplóba', () => {
    expect(serializeRequest({ method: 'GET', url: '/auth/callback?code=titok&state=s' }).url).toBe(
      '/auth/callback',
    );
    expect(serializeRequest({ method: 'GET', url: '/api/v1/me?x=1' }).url).toBe('/api/v1/me?x=1');
  });
});
