import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './client';

function stubFetch(response: Response | Error) {
  const fn = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const problem = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
  it('GET: same-origin sütivel, CSRF-fejléc nélkül megy', async () => {
    const fn = stubFetch(Response.json([1, 2]));
    const result = await apiFetch<number[]>('/api/v1/spaces', { csrfToken: 'tok' });
    expect(result).toEqual([1, 2]);
    const init = (fn.mock.calls as unknown as [string, RequestInit][])[0]?.[1];
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin' });
    expect(init?.headers).not.toHaveProperty('X-CSRF-Token');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    '%s: X-CSRF-Token fejléccel és JSON-törzzsel megy',
    async (method) => {
      const fn = stubFetch(new Response(null, { status: 204 }));
      await apiFetch('/api/v1/x', { method, body: { a: 1 }, csrfToken: 'tok-1' });
      const init = (fn.mock.calls as unknown as [string, RequestInit][])[0]?.[1];
      expect(init?.headers).toMatchObject({
        'X-CSRF-Token': 'tok-1',
        'Content-Type': 'application/json',
      });
      expect(init?.body).toBe('{"a":1}');
    },
  );

  it('204-re undefined-ot ad', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(apiFetch('/api/v1/me/current-space', { method: 'PUT' })).resolves.toBeUndefined();
  });

  it('Problem Details-ből típusos hibakódot és details-t olvas, a szöveget nem használja', async () => {
    stubFetch(
      problem(403, {
        status: 403,
        code: 'not_space_member',
        title: 'Szabadon változó cím',
        detail: 'Szabadon változó részlet',
        details: { space: { id: 's', name: 'Fejlesztés' } },
      }),
    );
    const error = await apiFetch('/api/v1/spaces/s').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('not_space_member');
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).details).toEqual({ space: { id: 's', name: 'Fejlesztés' } });
    expect((error as ApiError).message).not.toContain('Szabadon');
  });

  it('ismeretlen kódot és nem-JSON hibát internal_error-ra (401-nél unauthenticated-re) képez', async () => {
    stubFetch(problem(418, { code: 'valami_uj' }));
    await expect(apiFetch('/x')).rejects.toMatchObject({ code: 'internal_error', status: 418 });
    stubFetch(new Response('<html>', { status: 502 }));
    await expect(apiFetch('/x')).rejects.toMatchObject({ code: 'internal_error' });
    stubFetch(new Response('', { status: 401 }));
    await expect(apiFetch('/x')).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('hálózati hibából network kódú ApiError lesz', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    await expect(apiFetch('/x')).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('megszakított kérésnél az eredeti hibát dobja', async () => {
    const controller = new AbortController();
    controller.abort();
    stubFetch(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(apiFetch('/x', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
