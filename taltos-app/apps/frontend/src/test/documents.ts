import type { DocumentDetail, KindRef, TagListResponse, TagSearchResponse } from '@taltos/shared';
import { makeMe, mockApi, type RouteTable } from './helpers';
import { summaries } from './helpers';
import type { SpaceSummary } from '@taltos/shared';

export const DOC_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
export const NEW_DOC_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

export const kinds: KindRef[] = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'guide', label: 'Útmutató' },
];

export const tagList: TagListResponse = {
  tags: [
    { id: 'tag-prompt', name: 'Prompt', count: 3 },
    { id: 'tag-quick', name: 'Gyorsindítás', count: 1 },
    { id: 'tag-prompts', name: 'Promptok', count: 2 },
  ],
};

export const owner = { id: 'u-me', displayName: 'Kovács Anna', avatarUrl: null };

export function makeDoc(extra: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: DOC_ID,
    spaceId: summaries[0]?.id ?? '',
    slug: 'gyorsvalaszok',
    title: 'Ügyfélszolgálati gyorsválaszok',
    kind: 'prompt',
    owner,
    reviewState: 'draft',
    approvedRevisionId: null,
    iteration: 0,
    archived: false,
    tags: [{ id: 'tag-prompt', name: 'Prompt' }],
    approvedMetadata: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    ...extra,
  };
}

export const noContent = () => new Response(null, { status: 204 });
export const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });

type Options = {
  me?: ReturnType<typeof makeMe>;
  spaces?: SpaceSummary[];
  kinds?: KindRef[];
  search?: TagSearchResponse | Response | 'pending';
  routes?: RouteTable;
};

/** A dokumentum-felületek közös `fetch`-mockja: `/me`, színterek, fajták, címkék (lista és `?q=`). */
export function documentApi(options: Options = {}) {
  return mockApi({
    'GET /api/v1/me': () => Response.json(options.me ?? makeMe()),
    'GET /api/v1/spaces': () => Response.json(options.spaces ?? summaries),
    'GET /api/v1/kinds': () => Response.json(options.kinds ?? kinds),
    'GET /api/v1/tags': ({ url }) => {
      if (!url.searchParams.has('q')) return Response.json(tagList);
      const search = options.search ?? { exact: null, similar: [] };
      return search === 'pending'
        ? 'pending'
        : search instanceof Response
          ? search.clone()
          : Response.json(search);
    },
    ...options.routes,
  });
}
