import type { EulerSDK, VaultEntity } from '@eulerxyz/euler-v2-sdk';
import type { Address } from 'viem';

import { getRuntimeConfig } from 'appconfig/runtime';

export interface ExploreSdkFallbackResult {
  vaults: VaultEntity[];
  unresolved: string[];
  warnings: string[];
}

const sdkPromises = new Map<number, Promise<EulerSDK>>();

async function getExploreSdk(chainId: number) {
  let sdkPromise = sdkPromises.get(chainId);
  if (!sdkPromise) {
    sdkPromise = import('@eulerxyz/euler-v2-sdk').then(({ buildEulerSDK }) => {
      const runtime = getRuntimeConfig();
      const chain = runtime.chains.find((candidate) => candidate.chainId === chainId);
      if (!chain) throw new Error(`Missing RPC configuration for chain ${chainId}`);
      return buildEulerSDK({
        config: {
          rpcUrls: { [chainId]: chain.rpcUrl },
          v3ApiUrl: runtime.eulerApi.v3BaseUrl,
          eVaultServiceAdapter: 'fallback',
          vaultTypeAdapter: 'fallback',
          eulerLabelsBaseUrl: runtime.eulerApi.labelsBaseUrl
        }
      });
    });
    sdkPromises.set(chainId, sdkPromise);
    // Evict failed initializations (chunk-load errors, bad RPC config) so the
    // next call retries instead of replaying the cached rejection forever.
    sdkPromise.catch(() => {
      if (sdkPromises.get(chainId) === sdkPromise) sdkPromises.delete(chainId);
    });
  }

  return sdkPromise;
}

/**
 * Lazy V3/on-chain fallback for vaults absent from the product batch response,
 * including Securitize collateral vaults. The SDK import stays out of the
 * Explore page's initial bundle.
 */
export async function fetchExploreSdkFallback(chainId: number, addresses: string[]): Promise<ExploreSdkFallbackResult> {
  const unique = Array.from(
    new Set(addresses.map((address) => address.toLowerCase()).filter((address) => address.startsWith('0x')))
  ) as Address[];

  if (unique.length === 0) {
    return { vaults: [], unresolved: [], warnings: [] };
  }

  const sdk = await getExploreSdk(chainId);
  const response = await sdk.vaultMetaService.fetchVaults(chainId, unique, {
    populateCollaterals: true,
    populateMarketPrices: true,
    populateLabels: true
  });
  const vaults = response.result.filter((vault): vault is VaultEntity => vault != null);
  const resolved = new Set(vaults.map((vault) => vault.address.toLowerCase()));

  return {
    vaults,
    unresolved: unique.filter((address) => !resolved.has(address)),
    warnings: response.errors.map((error) => error.message)
  };
}

export async function fetchExploreOracleMetadata(chainId: number): Promise<Record<string, unknown>> {
  const sdk = await getExploreSdk(chainId);
  return sdk.oracleAdapterService.fetchOracleAdapterMap(chainId);
}
