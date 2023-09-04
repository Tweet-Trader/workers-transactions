import { Router, error, json, type IRequest } from 'itty-router'
import { privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, publicActions, http, parseEther, parseUnits, createPublicClient, numberToBytes } from 'viem'
// import { mainnet } from 'viem/chains'
import jwt from '@tsndr/cloudflare-worker-jwt'
import { twitterBotAbi } from './abis/twitterBot'
import { v2FactoryAbi } from './abis/v2Factory'
import { pairAbi } from './abis/pair'
import { foundry, WETH, TRANSFER, uniswap, getAmountOut, getBasisPointsMultiplier, V2_ROUTER, uint256Max } from './helpers'

export interface Env {
	RPC_URL: string;
	TWITTER_BOT_ADDRESS: `0x${string}`;
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

type RequestBody = {
	twitterId: string;
	tokenAddress: `0x${string}`;
	amount: string;
	slippage: number;
}

const router = Router()

const setupViemClient = async (twitterId: string, env: Env) => {
	// const privateKey = await env.keys.get(twitterId) as `0x${string}`;
	// if (!privateKey) throw new Error('User Not Found');
	// const account = privateKeyToAccount(privateKey);
	const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

	const client = createWalletClient({
		// account,
		chain: foundry,
		transport: http(env.RPC_URL),
	}).extend(publicActions);

	return { account, client };
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

const fetchTokenDecimals = async (tokenAddress: `0x${string}`, env: Env) => {
	const client = createPublicClient({
		chain: foundry,
		transport: http(env.RPC_URL),
	})

	const decimals = await client.readContract({
		address: tokenAddress,
		abi: [{ name: "decimals", outputs: [{ internalType: "uint8", name: "", type: "uint8" }], inputs: [], stateMutability: "view", type: "function" }] as const,
		functionName: 'decimals',
	})

	return decimals
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
		pair,
		[token0]: token0Reserves,
		[token1]: token1Reserves,
	}
}

// @param ethAmount will be in ether
// @param slippage will be in the percentage form (ie: 5% => 0.05)
const buy = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	try {
		console.log("buy functionality accessed");
		const { twitterId, tokenAddress, amount, slippage } = await request.json() as RequestBody;
		const { account, client } = await setupViemClient(twitterId, env);
		console.log("client setup");

		const amountIn = BigInt(amount);
		const { pair, tokenReserves, wethReserves } = await getReserves(tokenAddress, env);
		const amountOut = getAmountOut(amountIn, wethReserves as bigint, tokenReserves as bigint);
		const bp = getBasisPointsMultiplier(slippage);
		const amountOutMin = amountOut * BigInt((100 - slippage) * bp) / BigInt(100 * bp);
		console.log("slippage calculated");

		const { request: contractWriteRequest, result } = await client.simulateContract({
			account,
			address: env.TWITTER_BOT_ADDRESS,
			abi: twitterBotAbi,
			functionName: uniswap.buy['v2'],
			args: [tokenAddress, amountOutMin],
			value: amountIn,
		})
		const txHash = await client.writeContract(contractWriteRequest);
		const receipt = await client.waitForTransactionReceipt({ 
			hash: txHash,
			// confirmations: 2, MAY NEED TO ENABLE THIS IN THE FUTURE
		})
		console.log("transaction completed with receipt: ", JSON.stringify(bigintTransform(receipt), null, 2));

		const log = receipt.logs
			.find((log) => log.address === tokenAddress.toLowerCase() 
				&& log.topics[0] === TRANSFER
				&& `0x${log.topics[1]?.slice(-40)}` === pair.toLowerCase()
				&& `0x${log.topics[2]?.slice(-40)}` === account.address.toLowerCase()
			)
		if (!log) return error(500, 'Unable to locate transfer event');
		const transferredAmount = BigInt(log.data)
		console.log("log parsed from receipt: ", JSON.stringify(bigintTransform(log), null, 2));

		// load this data into d1
		const results = await env.DB.prepare(
			'INSERT INTO Transactions(hash, wallet_address, twitter_id, token_address, amount_in, amount_out, swap_type, block_number) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
		)
			.bind(txHash, account.address, twitterId, tokenAddress, numberToBytes(amountIn, { size: 32 }), numberToBytes(transferredAmount, { size: 32 }), 'BUY', Number(log.blockNumber))
			.run();
		console.log("database updated with results: ", results);

		return txHash;
	} catch (err: any) {
		return error(500, err.message);
	}
}

const bigintTransform = (obj: Record<string, any>) => {
	const result = {};
	for (const key in obj) {
		const value = obj[key];
		if (typeof value === 'bigint') {
			result[key] = value.toString();
		} else if (typeof value === 'object') {
			result[key] = bigintTransform(value);
		} else {
			result[key] = value;
		}
	}
	return result;
}

// @param ethAmount will be in ether
// @param slippage will be in the percentage form (ie: 5% => 0.05)
const sell = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	try {
		console.log("sell functionality accessed");
		const { twitterId, tokenAddress, amount, slippage } = await request.json() as RequestBody;
		const { account, client } = await setupViemClient(twitterId, env);
		console.log("client setup");

		const amountIn = BigInt(amount);
		const { pair, tokenReserves, wethReserves } = await getReserves(tokenAddress, env);
		const amountOut = getAmountOut(amountIn, tokenReserves as bigint, wethReserves as bigint);
		const bp = getBasisPointsMultiplier(slippage);
		const amountOutMin = amountOut * BigInt((100 - slippage) * bp) / BigInt(100 * bp);
		console.log("slippage calculated: ", amountOutMin.toString());

		const { request: contractWriteRequest, result } = await client.simulateContract({
			account,
			address: env.TWITTER_BOT_ADDRESS,
			abi: twitterBotAbi,
			functionName: uniswap.sell['v2'],
			args: [tokenAddress, amountIn, amountOutMin],
		})
		const txHash = await client.writeContract(contractWriteRequest);
		const receipt = await client.waitForTransactionReceipt({ 
			hash: txHash,
			// confirmations: 2, MAY NEED TO ENABLE THIS IN THE FUTURE
		})
		console.log("transaction completed with receipt: ", JSON.stringify(bigintTransform(receipt), null, 2));

		const log = receipt.logs
			.find((log) => log.address === WETH.toLocaleLowerCase()
				&& log.topics[0] === TRANSFER
				&& `0x${log.topics[1]?.slice(-40)}` === pair.toLowerCase()
				&& `0x${log.topics[2]?.slice(-40)}` === V2_ROUTER.toLowerCase()
			)
		if (!log) return error(500, 'Unable to locate transfer event');
		const transferredAmount = BigInt(log.data)
		console.log("log parsed from receipt: ", JSON.stringify(bigintTransform(log), null, 2));

		const results = await env.DB.prepare(
			'INSERT INTO Transactions(hash, wallet_address, twitter_id, token_address, amount_in, amount_out, swap_type, block_number) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
		)
			.bind(txHash, account.address, twitterId, tokenAddress, numberToBytes(amountIn, { size: 32 }), numberToBytes(transferredAmount, { size: 32 }), 'SELL', Number(log.blockNumber))
			.run();
		console.log("database updated with results: ", results);

		return { status: 200, txHash };
	} catch (err: any) {
		return error(500, err.message);
	}
}

const approve = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	try {
		const { twitterId, tokenAddress } = await request.json() as RequestBody;
		const { account, client } = await setupViemClient(twitterId, env);

		const allowance = await client.readContract({
			account,
			address: tokenAddress,
			abi: [{ name: "allowance", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], inputs: [{ internalType: "address", name: "owner", type: "address" }, { internalType: "address", name: "spender", type: "address" }], stateMutability: "view", type: "function" }] as const,
			functionName: 'allowance',
			args: [account.address, env.TWITTER_BOT_ADDRESS],
		})
		if (allowance === BigInt(uint256Max)) return { status: 200, message: 'Already Approved' };
		const txHash = await client.writeContract({
			account,
			address: tokenAddress,
			abi: [{ name: "approve", outputs: [], inputs: [{ internalType: "address", name: "spender", type: "address" }, { internalType: "uint256", name: "amount", type: "uint256" }], stateMutability: "nonpayable", type: "function" }] as const,
			functionName: 'approve',
			args: [env.TWITTER_BOT_ADDRESS, BigInt(uint256Max)],
		})
		await client.waitForTransactionReceipt({ 
			hash: txHash,
			// confirmations: 2, MAY NEED TO ENABLE THIS IN THE FUTURE
		})

		return { status: 200, txHash };
	} catch (err: any) {
		return error(500, err.message);
	}
}

router
	// .get('*', isAuthorized)
	.get('/getPairAddress/:tokenAddress', getPairAddress)
	.post('/buy', buy)
	.post('/sell', sell)
	.post('/approve', approve)

export default {
	fetch: (request: IRequest, env: Env, ctx: ExecutionContext) => router
		.handle(request, env, ctx)
		.then(json)
		.catch(error)
};
