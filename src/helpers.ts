import type { IRequest } from 'itty-router'
import { http, createPublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { defineChain } from 'viem'
import { v2FactoryAbi } from './abis/v2Factory'
import { pairAbi } from './abis/pair'

interface Env {
	RPC_URL: string;
	// DB: 
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	keys: KVNamespace;
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

export const foundry = /*#__PURE__*/ defineChain({
  id: 1,
  name: 'Foundry',
  network: 'foundry',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['http://127.0.0.1:8545'],
      webSocket: ['ws://127.0.0.1:8545'],
    },
    public: {
      http: ['http://127.0.0.1:8545'],
      webSocket: ['ws://127.0.0.1:8545'],
    },
  },
})

// ==========================================
// UNISWAP METHODS
// ==========================================

type Uniswap = {
	factory: {
		v2: `0x${string}`,
	},
	buy: {
		v2: "buyTokens_v2Router",
		v3: "buyTokens_v3Router",
	},
	sell: {
		v2: "sellTokens_v2Router",
		v3: "sellTokens_v3Router",
	}
}
export const uniswap: Uniswap = {
	factory: {
		v2: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
	},
	buy: {
		v2: "buyTokens_v2Router",
		v3: "buyTokens_v3Router",
	},
	sell: {
		v2: "sellTokens_v2Router",
		v3: "sellTokens_v3Router",
	}
}

export const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

// ==========================================
// UNISWAP
// ==========================================
export const getAmountOut = (amountIn: bigint, reserveIn: bigint, reserveOut: bigint) => {
  if (reserveIn === BigInt(0) || reserveOut === BigInt(0)) throw new Error('Insufficient Liquidity');
  const amountInWithFee = amountIn * BigInt(997);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BigInt(1000) + amountInWithFee;

  return numerator / denominator;
}

export const getBasisPointsMultiplier = (decimal: number | string) => {
  const decimalLength = decimal.toString().split('.')[1]?.length || 0

  return 10 ** decimalLength;
}
