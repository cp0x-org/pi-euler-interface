import { getRuntimeConfig } from '@/appconfig/runtime';
import {
  EulerAccountPortfolio,
  EulerChain,
  EulerEarnVault,
  EulerEarnVaultLabel,
  EulerEarnTotals,
  EulerEntities,
  EulerIntrinsicApy,
  EulerPrice,
  EulerProducts,
  EulerTokenList,
  EulerVaultRewards,
  EulerVaultsResponse,
  V3VaultDetail,
  V3VaultListItem
} from 'types/euler';

// Fetchers reproducing the data sources of the Euler app:
// - v3.euler.finance — the official public API (CORS-open) for vault data, APYs, prices;
//   called directly from the browser (v3BaseUrl in runtime config).
// - labels.euler.finance — the public repository-backed metadata CDN.
// - app.euler.finance internal endpoints — used only for chain/token metadata through
//   the same-origin dev proxy (baseUrl = /euler-api).

function apiBase(): string {
  return getRuntimeConfig().eulerApi.baseUrl;
}

function v3Base(): string {
  return getRuntimeConfig().eulerApi.v3BaseUrl;
}

function labelsBase(): string {
  return getRuntimeConfig().eulerApi.labelsBaseUrl;
}

async function requestJson<T>(url: string, init?: RequestInit, missingValue?: T): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    // The labels CDN returns 403 for paths that do not exist, while the upstream repository
    // returns 404. A configured chain without optional labels is valid and simply has no
    // curated products/entities yet; genuine server/network failures still propagate.
    if (missingValue !== undefined && (res.status === 403 || res.status === 404)) return missingValue;
    throw new Error(
      `Euler API ${url.replace(apiBase(), '').replace(v3Base(), '').replace(labelsBase(), '')} failed: ${res.status} ${res.statusText}`
    );
  }
  return res.json() as Promise<T>;
}

const getJson = <T>(path: string) => requestJson<T>(`${apiBase()}${path}`, { headers: { Accept: 'application/json' } });
const getV3Json = <T>(path: string) => requestJson<T>(`${v3Base()}${path}`, { headers: { Accept: 'application/json' } });
const getLabelsJson = <T>(path: string, missingValue?: T) =>
  requestJson<T>(`${labelsBase()}${path}`, { headers: { Accept: 'application/json' } }, missingValue);
const postV3Json = <T>(path: string, body: unknown) =>
  requestJson<T>(`${v3Base()}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

// Euler injects diagnostic keys (countryCode, isProxyOrVpn, ...) into label
// payloads; keep only real record entries.
function stripInjectedKeys<T extends object>(obj: Record<string, unknown>, isRecord: (v: unknown) => boolean): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => isRecord(v))) as T;
}

// GET /api/internal/euler-chains
export const fetchEulerChains = () => getJson<EulerChain[]>('/internal/euler-chains');

// GET /api/internal/token-list?chainId=N
export const fetchTokenList = (chainId: number) => getJson<EulerTokenList>(`/internal/token-list?chainId=${chainId}`);

// GET {labelsBaseUrl}/{chainId}/products.json
export const fetchProducts = async (chainId: number) => {
  const raw = await getLabelsJson<Record<string, unknown>>(`/${chainId}/products.json`, {});
  return stripInjectedKeys<EulerProducts>(raw, (v) => !!v && typeof v === 'object' && Array.isArray((v as { vaults?: unknown }).vaults));
};

// GET {labelsBaseUrl}/{chainId}/entities.json
export const fetchEntities = async (chainId: number) => {
  const raw = await getLabelsJson<Record<string, unknown>>(`/${chainId}/entities.json`, {});
  return stripInjectedKeys<EulerEntities>(raw, (v) => !!v && typeof v === 'object');
};

// GET {labelsBaseUrl}/{chainId}/earn-vaults.json
// The file is a set of vault addresses, but nothing upstream enforces that: a repeated (or
// differently-cased) address would be requested twice, come back twice from the batch endpoint and
// render as two Earn cards sharing one React key. Collapse duplicates here, keeping the first
// entry's metadata, so every consumer sees one label per vault.
export const fetchEarnVaultLabels = async (chainId: number): Promise<EulerEarnVaultLabel[]> => {
  const raw = await getLabelsJson<unknown[]>(`/${chainId}/earn-vaults.json`, []);

  const labels = new Map<string, EulerEarnVaultLabel>();
  for (const entry of raw) {
    const label =
      typeof entry === 'string'
        ? { address: entry }
        : entry && typeof entry === 'object' && typeof (entry as EulerEarnVaultLabel).address === 'string'
          ? (entry as EulerEarnVaultLabel)
          : undefined;
    if (!label) continue;
    const key = label.address.toLowerCase();
    if (!labels.has(key)) labels.set(key, label);
  }

  return Array.from(labels.values());
};

// GET /api/internal/vaults?chainId=N — the snapshot the Euler app itself uses; kept for
// reference, but it sits behind strict bot protection — prefer the public v3 endpoints.
export const fetchInternalVaults = (chainId: number) => getJson<EulerVaultsResponse>(`/internal/vaults?chainId=${chainId}`);

// GET https://v3.euler.finance/v3/evk/vaults?chainId=N — public flat vault list (paged, limit<=100)
export const fetchVaultList = (chainId: number, offset = 0, limit = 100) =>
  getV3Json<{ data: V3VaultListItem[]; meta: { total: number; offset: number; limit: number } }>(
    `/v3/evk/vaults?chainId=${chainId}&offset=${offset}&limit=${limit}`
  );

// POST https://v3.euler.finance/v3/evk/vaults/batch — vault details incl. collaterals
export const fetchVaultsBatch = (chainId: number, addresses: string[], include: string[] = ['collaterals']) =>
  postV3Json<{ data: V3VaultDetail[]; meta: { count: number; notFound: string[] } }>('/v3/evk/vaults/batch', {
    chainId,
    addresses,
    include
  });

// POST https://v3.euler.finance/v3/earn/vaults/batch — verified Earn vault
// summaries plus their allocation strategies.
export const fetchEarnVaultsBatch = (chainId: number, addresses: string[]) =>
  postV3Json<{
    data: EulerEarnVault[];
    meta: { count: number; requested: number; notFound: string[]; timestamp: string; chainId: string };
  }>('/v3/earn/vaults/batch', {
    chainId,
    addresses,
    include: ['strategies']
  });

// GET https://v3.euler.finance/v3/earn/vaults/{chainId}/{address} — complete
// Earn vault details including strategies and governance/management metadata.
export const fetchEarnVault = (chainId: number, address: string) =>
  getV3Json<{ data: EulerEarnVault; meta: { timestamp: string } }>(`/v3/earn/vaults/${chainId}/${address}`);

// GET https://v3.euler.finance/v3/earn/vaults/{chainId}/{address}/totals
export const fetchEarnVaultTotals = (chainId: number, address: string, from: number, to: number) =>
  getV3Json<{
    data: EulerEarnTotals;
    meta: { chainId: string; vault: string; resolution: '1d'; startTimestamp: string; endTimestamp: string; timestamp: string };
  }>(`/v3/earn/vaults/${chainId}/${address}/totals?resolution=1d&from=${from}&to=${to}`);

// GET https://v3.euler.finance/v3/prices?chainId=N&assets=0x..,0x..&limit=K
export const fetchPrices = (chainId: number, assets: string[]) =>
  getV3Json<{ data: EulerPrice[] }>(`/v3/prices?chainId=${chainId}&assets=${encodeURIComponent(assets.join(','))}&limit=${assets.length}`);

// GET https://v3.euler.finance/v3/apys/intrinsic?chainId=N&offset=0&limit=100
export const fetchIntrinsicApys = (chainId: number, offset = 0, limit = 100) =>
  getV3Json<{ data: EulerIntrinsicApy[] }>(`/v3/apys/intrinsic?chainId=${chainId}&offset=${offset}&limit=${limit}`);

// GET https://v3.euler.finance/v3/apys/rewards?chainId=N&offset=0&limit=100
export const fetchRewardApys = (chainId: number, offset = 0, limit = 100) =>
  getV3Json<{ data: EulerVaultRewards[] }>(`/v3/apys/rewards?chainId=${chainId}&offset=${offset}&limit=${limit}`);

// GET https://v3.euler.finance/v3/accounts/{address}/portfolio?chainId=N — the connected
// account's holdings: borrow positions, Earn/Lend deposits and portfolio totals in one call.
// Without `forceFresh` the endpoint answers from a snapshot cache that can be hours old
// (`data.freshness.mode = 'cached'`), which makes balances and the net asset value drift away from
// the official app. Asking for a fresh snapshot is cheap: the backend recomputes at most once per
// short interval and falls back to the cache when rate-limited.
export const fetchAccountPortfolio = (chainId: number, address: string, forceFresh = true) =>
  getV3Json<{ data: EulerAccountPortfolio; meta: { timestamp: string; chainId: string } }>(
    `/v3/accounts/${address}/portfolio?chainId=${chainId}${forceFresh ? '&forceFresh=true' : ''}`
  );

// JSON-RPC against the chain RPC from runtime config (the Euler app proxies
// this through /api/internal/rpc/{chainId}; we hit the configured RPC directly).
export async function rpcCall<T = unknown>(chainId: number, method: string, params: unknown[]): Promise<T> {
  const chain = getRuntimeConfig().chains.find((c) => c.chainId === chainId);
  if (!chain) throw new Error(`No RPC configured for chain ${chainId}`);
  const res = await fetch(chain.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method} error: ${json.error.message}`);
  return json.result as T;
}

// Token icon URL served by Euler's token image CDN
export function tokenImageUrl(chainId: number, address: string): string {
  return `${getRuntimeConfig().eulerApi.tokenImagesBaseUrl}/${chainId}/${address}`;
}

// Entity logos are file names in entities.json. Binary assets use the raw public
// euler-labels repository because some browsers reject CDN PNG responses via ORB.
export function entityLogoUrl(logo?: string): string | undefined {
  if (!logo) return undefined;
  if (/^https?:\/\//i.test(logo)) return logo;
  return `${getRuntimeConfig().eulerApi.labelsImagesBaseUrl}/logo/${logo}`;
}
