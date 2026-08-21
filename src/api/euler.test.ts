import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadRuntimeConfig } from '@/appconfig/runtime';

import { fetchEarnVaultLabels } from './euler';

const LABELS_BASE = 'https://labels.example/master';

const jsonResponse = (payload: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => payload }) as unknown as Response;

/** Serves /config.json plus one labels payload; every other URL fails the test loudly. */
function stubFetch(labels: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/config.json')) {
      return jsonResponse({
        appName: 'test',
        defaultChainId: 1,
        eulerApi: {
          baseUrl: '/euler-api',
          v3BaseUrl: 'https://v3.example',
          tokenImagesBaseUrl: 'https://images.example',
          labelsBaseUrl: LABELS_BASE,
          labelsImagesBaseUrl: 'https://raw.example'
        },
        walletConnectProjectId: '',
        chains: []
      });
    }
    if (url.startsWith(`${LABELS_BASE}/999/earn-vaults.json`)) return jsonResponse(labels);
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('fetchEarnVaultLabels', () => {
  beforeAll(() => {
    stubFetch([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('collapses repeated vault addresses regardless of casing', async () => {
    stubFetch([
      { address: '0xF868A2B30854FE13e26F7AB7a92609cCb6b9c0e1', description: 'first' },
      '0xf868a2b30854fe13e26f7ab7a92609ccb6b9c0e1',
      { address: '0xEbbb1e5Dd7E9C4DCa7B7fD4442571cAE5Fb37629' }
    ]);
    await loadRuntimeConfig();

    const labels = await fetchEarnVaultLabels(999);

    expect(labels.map((label) => label.address)).toEqual([
      '0xF868A2B30854FE13e26F7AB7a92609cCb6b9c0e1',
      '0xEbbb1e5Dd7E9C4DCa7B7fD4442571cAE5Fb37629'
    ]);
    // The first entry wins, so its metadata is not lost to a bare-address duplicate.
    expect(labels[0].description).toBe('first');
  });

  it('keeps plain string entries and drops malformed ones', async () => {
    stubFetch(['0xF868A2B30854FE13e26F7AB7a92609cCb6b9c0e1', null, 42, { name: 'no address' }]);
    await loadRuntimeConfig();

    const labels = await fetchEarnVaultLabels(999);

    expect(labels).toEqual([{ address: '0xF868A2B30854FE13e26F7AB7a92609cCb6b9c0e1' }]);
  });
});
