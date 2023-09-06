import { type IRequest } from 'itty-router'
import { privateKeyToAccount } from 'viem/accounts'
import { http, formatUnits, createPublicClient } from 'viem'
// import { mainnet } from 'viem/chains'
import { v2FactoryAbi } from './abis/v2Factory'
import { pairAbi } from './abis/pair'
import { foundry, WETH, uniswap } from './helpers'

export interface Env {
	RPC_URL: string;
	TWITTER_BOT_ADDRESS: `0x${string}`;
	TWITTER_BOT_AUTH_KEY_SECRET: string;
	// DB: 
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	keys: KVNamespace;
	DB:  D1Database;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;	
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;
}

export const getAccount = async (twitterId: string, env: Env) => {
	const privateKey = await env.keys.get(twitterId) as `0x${string}`;
	if (!privateKey) throw new Error('User Not Found');
	const account = privateKeyToAccount(privateKey);

	return account;
}

const setupClient = (env: Env) => {
	const client = createPublicClient({
		chain: foundry,
		transport: http(env.RPC_URL),
	})

  return client;
}

const fetchPairAddress = async (tokenAddress: `0x${string}`, env: Env) => {
  const client = setupClient(env);
	const pair = await client.readContract({
		address: uniswap.factory['v2'],
		abi: v2FactoryAbi,
		functionName: 'getPair',
		args: [tokenAddress, WETH],
	})

	return pair;
}

export const fetchSymbol = async (tokenAddress: `0x${string}`, env: Env) => {
  const client = setupClient(env);
	const symbol = await client.readContract({
		address: tokenAddress,
		abi: [{ name: "symbol", outputs: [{ internalType: "string", name: "", type: "string" }], inputs: [], stateMutability: "view", type: "function" }] as const,
		functionName: 'symbol',
	})

	return symbol;
}

type Reserve = { 
	pair: `0x${string}`; 
	tokenReserves: bigint;
	wethReserves: bigint;
};
export const getTokenPrice = (token: Reserve, usdc: Reserve, decimals: number) => {
	const usdcWethRatio = Number(formatUnits(usdc.tokenReserves as bigint, 6)) / Number(formatUnits(usdc.wethReserves as bigint, 18));
	const wethTokenRatio = Number(formatUnits(token.wethReserves as bigint, 18)) / Number(formatUnits(token.tokenReserves as bigint, decimals));

	return usdcWethRatio * wethTokenRatio;
}

 const fetchTokenDecimals = async (tokenAddress: `0x${string}`, env: Env) => {
  const client = setupClient(env);
	const decimals = await client.readContract({
		address: tokenAddress,
		abi: [{ name: "decimals", outputs: [{ internalType: "uint8", name: "", type: "uint8" }], inputs: [], stateMutability: "view", type: "function" }] as const,
		functionName: 'decimals',
	})

	return decimals
}

export const getPairAddress = async (request: IRequest, env: Env) => {
	const tokenAddress = request.params.tokenAddress as `0x${string}`;
	if (!tokenAddress) throw Error('Invalid Token Address');
	const pair = await fetchPairAddress(tokenAddress, env);

	return { pair }
}

export const getReserves = async (tokenAddress: `0x${string}`, env: Env): Promise<Reserve> => {
  const client = setupClient(env);
	const pair = await fetchPairAddress(tokenAddress, env);
	const [token0Reserves, token1Reserves] = await client.readContract({
		address: pair,
		abi: pairAbi,
		functionName: 'getReserves',
	});

	return {
		pair,
		tokenReserves: tokenAddress < WETH ? token0Reserves : token1Reserves,
		wethReserves: tokenAddress < WETH ? token1Reserves : token0Reserves,
	}
}

