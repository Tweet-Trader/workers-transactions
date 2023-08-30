import { Router, error, json, type IRequest } from 'itty-router'
import { privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, publicActions, http, Client, parseEther, createPublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { defineChain } from 'viem'
import jwt from '@tsndr/cloudflare-worker-jwt'
import { twitterBotAbi } from './abis/twitterBot'
import { v2FactoryAbi } from './abis/v2Factory'
import { pairAbi } from './abis/pair'
import { foundry, WETH, uniswap, getAmountOut, getBasisPointsMultiplier } from './helpers'

export interface Env {
	RPC_URL: string;
	TWITTER_BOT_ADDRESS: `0x${string}`;
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

type RequestBody = {
	twitterId: string;
	tokenAddress: `0x${string}`;
	ethAmount: string;
	slippage: number;
}

const router = Router()

const setupViemClient = async (twitterId: string, env: Env) => {
	// const privateKey = await env.keys.get(twitterId) as `0x${string}`;
	// if (!privateKey) throw new Error('User Not Found');
	// const account = privateKeyToAccount(privateKey);
	const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

	const client = createWalletClient({
		account,
		chain: foundry,
		transport: http(env.RPC_URL),
	}).extend(publicActions);

	return { client };
}

const isAuthorized = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	const { twitterId } = await request.json() as RequestBody;
	const token = request.headers.get('Authorization');
	const privateKey = await env.keys.get(twitterId);

	if (!token) return error(401, 'Unauthorized');
	if (!privateKey) return error(404, 'User Not Found');

	const isValid = await jwt.verify(token, `${privateKey}_access`);
	if (!isValid) return error(401, 'Unauthorized');
}

const fetchPairAddress = async (tokenAddress: `0x${string}`, env: Env) => {
	const client = createPublicClient({
		chain: foundry,
		transport: http(env.RPC_URL),
	})

	const pair = await client.readContract({
		address: uniswap.factory['v2'],
		abi: v2FactoryAbi,
		functionName: 'getPair',
		args: [tokenAddress, WETH],
	})

	return pair;
}

const getPairAddress = async (request: IRequest, env: Env) => {
	const tokenAddress = request.params.tokenAddress as `0x${string}`;
	if (!tokenAddress) throw Error('Invalid Token Address');
	const pair = await fetchPairAddress(tokenAddress, env);

	return { pair }
}

const getReserves = async (tokenAddress: `0x${string}`, env: Env) => {
	const client = createPublicClient({
		chain: foundry,
		transport: http(env.RPC_URL),
	});

	const pair = await fetchPairAddress(tokenAddress, env);
	const [token0, token1] = tokenAddress < WETH ? ['tokenReserves', 'wethReserves'] : ['wethReserves', 'tokenReserves'];
	const [token0Reserves, token1Reserves] = await client.readContract({
		address: pair,
		abi: pairAbi,
		functionName: 'getReserves',
	});

	return {
		[token0]: token0Reserves,
		[token1]: token1Reserves,
	}
}

// @param ethAmount will be in ether
// @param slippage will be in the percentage form (ie: 5% => 0.05)
const buy = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	try {
		const { twitterId, tokenAddress, ethAmount, slippage } = await request.json() as RequestBody;
		const { client } = await setupViemClient(twitterId, env);

		const amountIn = parseEther(ethAmount);

		const { tokenReserves, wethReserves } = await getReserves(tokenAddress, env);
		const amountOut = getAmountOut(amountIn, tokenReserves, wethReserves);
		const bp = getBasisPointsMultiplier(slippage);
		const amountOutMin = amountOut * BigInt((100 - slippage) * bp) / BigInt(100 * bp);

		console.log("twitter bot address: ", env.TWITTER_BOT_ADDRESS);
		console.log("token address: ", tokenAddress);
		console.log("amountOutMin: ", amountOutMin.toString());
		console.log("twitter bot address: ", env.TWITTER_BOT_ADDRESS);
		console.log("amount In: ", amountIn.toString());

		const { request: ethRequest, result } = await client.simulateContract({
			address: env.TWITTER_BOT_ADDRESS,
			abi: twitterBotAbi,
			functionName: uniswap.buy['v2'],
			args: [tokenAddress, amountOutMin],
			value: amountIn,
		})

		console.log("request: ", ethRequest);
		console.log("result: ", result);

		return new Response('Hello World!');
	} catch (err: any) {
		return error(500, err.message);
	}
}

router
	// .get('*', isAuthorized)
	.get('/getPairAddress/:tokenAddress', getPairAddress)
	.post('/buy', buy)

export default {
	fetch: (request: IRequest, env: Env, ctx: ExecutionContext) => router
		.handle(request, env, ctx)
		.then(json)
		.catch(error)
};
