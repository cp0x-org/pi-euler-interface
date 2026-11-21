import { type Address, type PublicClient, decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';

export const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
]);

/** USDT returns no bytes on a successful approval. Other ERC-20s return true or reject with false. */
export async function simulateTokenApproval(
  client: Pick<PublicClient, 'call'>,
  { account, token, spender, amount, chainId }: { account: Address; token: Address; spender: Address; amount: bigint; chainId: number }
) {
  const request = { account, chainId, address: token, abi: ERC20_ABI, functionName: 'approve', args: [spender, amount] } as const;
  const { data } = await client.call({ account, to: token, data: encodeFunctionData(request) });
  return !data || data === '0x' || decodeFunctionResult({ ...request, data }) ? request : undefined;
}

export const ERC4626_ABI = parseAbi([
  'function asset() view returns (address)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function maxDeposit(address receiver) view returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function maxRedeem(address owner) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewWithdraw(uint256 assets) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)'
]);
