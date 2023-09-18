import { defineChain } from 'viem'
import { type IRequest, error } from 'itty-router'
import jwt from '@tsndr/cloudflare-worker-jwt'

export type RequestBody = {
	twitterId: string;
	tokenAddress: `0x${string}`;
	amount: string;
	slippage: number;
	decimals: number;
	tokenPrice: number;
}

export const isAuthorized = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	console.log("does it even get in here?");
	let data;
	try {
		data = await request.json() as RequestBody;
	} catch(error) {
		console.error("error: ", error);
	}
	console.log("data: ", data);
	console.log("auth header: ", request.headers.get('Authorization'));
	const token = request.headers.get('Authorization')?.split(' ')?.[1];
	const privateKey = await env.keys.get(data!.twitterId);
	console.log("token: ", token)
	console.log("twitter id: ", data!.twitterId);
	console.log("private key: ", privateKey);

	if (!token) return error(401, 'Unauthorized');
	if (!privateKey) return error(404, 'User Not Found');

	const isValid = await jwt.verify(token, `${privateKey}_access`);
	if (!isValid) return error(401, 'Unauthorized');

	request.data = data
}

// Check requests for a pre-shared secret
export const isTwitterBot = (request: IRequest, env: Env, ctx: ExecutionContext) => {
  if (request.headers.get('X-Custom-Auth-Key') !== env.TWITTER_BOT_AUTH_KEY_SECRET) return error(401, 'Unauthorized');
};

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
export const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
// SHA3 hash of the string "Transfer(address,address,uint256)"
export const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const uint256Max = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

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

export const bigintTransform = (obj: Record<string, any>) => {
	const result: Record<string, any> = Object.keys(obj).reduce((acc, key) => {
		const value = obj[key];
		if (typeof value === 'bigint') {
			return { ...acc, [key]: value.toString() };
		} else if (typeof value === 'object') {
			return { ...acc, [key]: bigintTransform(value) };
		} else {
			return { ...acc, [key]: value };
		}
	}, {})

	return result
}

