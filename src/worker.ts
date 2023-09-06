import { Router, error, json, type IRequest } from 'itty-router'
import { privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, publicActions, http, numberToBytes, stringToHex, keccak256 } from 'viem'
// import { mainnet } from 'viem/chains'
import jwt from '@tsndr/cloudflare-worker-jwt'
import { twitterBotAbi } from './abis/twitterBot'
import { foundry, WETH, TRANSFER, uniswap, getAmountOut, getBasisPointsMultiplier, bigintTransform, V2_ROUTER, uint256Max, USDC } from './helpers'
import { getTokenPrice, getPairAddress, getReserves, fetchSymbol } from './contractMethods'

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

type RequestBody = {
	twitterId: string;
	tokenAddress: `0x${string}`;
	amount: string;
	slippage: number;
	decimals: number;
}

const router = Router()

const setupViemClient = async (twitterId: string, env: Env) => {
	// const account = getAccount(twitterId, env);
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

// Check requests for a pre-shared secret
const isTwitterBot = (request: IRequest, env: Env, ctx: ExecutionContext) => {
  if (request.headers.get('X-Custom-Auth-Key') !== env.TWITTER_BOT_AUTH_KEY_SECRET) return error(401, 'Unauthorized');
};

// @param ethAmount will be in ether
// @param slippage will be in the percentage form (ie: 5% => 0.05)
const buy = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	try {
		console.log("buy functionality accessed");
		const { twitterId, tokenAddress, amount, slippage, decimals } = await request.json() as RequestBody;
		const { account, client } = await setupViemClient(twitterId, env);
		console.log("client setup");

		const amountIn = BigInt(amount);
		const token = await getReserves(tokenAddress, env);
		const usdc = await getReserves(USDC, env);
		const symbol = await fetchSymbol(tokenAddress, env);

		const amountOut = getAmountOut(amountIn, token.wethReserves, token.tokenReserves);
		const bp = getBasisPointsMultiplier(slippage);
		const amountOutMin = amountOut * BigInt((100 - slippage) * bp) / BigInt(100 * bp);
		const tokenPrice = getTokenPrice(token, usdc, decimals);
		console.log("data prepared");

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
		console.log("transaction completed with txHash: ", txHash);

		const log = receipt.logs
			.find((log) => log.address === tokenAddress.toLowerCase() 
				&& log.topics[0] === TRANSFER
				&& `0x${log.topics[1]?.slice(-40)}` === token.pair.toLowerCase()
				&& `0x${log.topics[2]?.slice(-40)}` === account.address.toLowerCase()
			)
		if (!log) return error(500, 'Unable to locate transfer event');
		const transferredAmount = BigInt(log.data)
		console.log("log parsed from receipt: ", JSON.stringify(bigintTransform(log), null, 2));

		// load this data into d1
		const results = await env.DB.prepare(
			'INSERT INTO Transactions(id, hash, wallet_address, twitter_id, token_address, token_price, decimals, symbol, amount_in, amount_out, swap_type, block_number) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		)
			.bind(keccak256(stringToHex(crypto.randomUUID())), txHash, account.address, twitterId, tokenAddress, tokenPrice, decimals, symbol, numberToBytes(amountIn, { size: 32 }), numberToBytes(transferredAmount, { size: 32 }), 'BUY', Number(log.blockNumber))
			.run();
		console.log("database updated with results: ", results);

		return txHash;
	} catch (err: any) {
		return error(500, err.message);
	}
}

// @param ethAmount will be in ether
// @param slippage will be in the percentage form (ie: 5% => 0.05)
const sell = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	try {
		console.log("sell functionality accessed");
		const { twitterId, tokenAddress, amount, slippage, decimals } = await request.json() as RequestBody;
		const { account, client } = await setupViemClient(twitterId, env);
		console.log("client setup");

		const amountIn = BigInt(amount);
		const token = await getReserves(tokenAddress, env);
		const usdc = await getReserves(USDC, env);

		const amountOut = getAmountOut(amountIn, token.tokenReserves, token.wethReserves);
		const bp = getBasisPointsMultiplier(slippage);
		const amountOutMin = amountOut * BigInt((100 - slippage) * bp) / BigInt(100 * bp);
		const tokenPrice = getTokenPrice(token, usdc, decimals);
		const symbol = await fetchSymbol(tokenAddress, env);
		console.log("data prepared: ", symbol);

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
		console.log("transaction completed with receipt: ", txHash);

		const log = receipt.logs
			.find((log) => log.address === WETH.toLocaleLowerCase()
				&& log.topics[0] === TRANSFER
				&& `0x${log.topics[1]?.slice(-40)}` === token.pair.toLowerCase()
				&& `0x${log.topics[2]?.slice(-40)}` === V2_ROUTER.toLowerCase()
			)
		if (!log) return error(500, 'Unable to locate transfer event');
		const transferredAmount = BigInt(log.data)
		console.log("log parsed from receipt: ", JSON.stringify(bigintTransform(log), null, 2));

		const results = await env.DB.prepare(
			'INSERT INTO Transactions(id, hash, wallet_address, twitter_id, token_address, token_price, decimals, symbol, amount_in, amount_out, swap_type, block_number) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		)
			.bind(keccak256(stringToHex(crypto.randomUUID())), txHash, account.address, twitterId, tokenAddress, tokenPrice, decimals, symbol, numberToBytes(amountIn, { size: 32 }), numberToBytes(transferredAmount, { size: 32 }), 'SELL', Number(log.blockNumber))
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

type TransactionBody = {
	twitterId: string;
	transactionId: string;
}
const getTransaction = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	const { twitterId, transactionId } = await request.json() as TransactionBody;
	// const account = getAccount(twitterId, env);
	const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

	const data = await env.DB.prepare(
		"SELECT * FROM Transactions WHERE id = ?"
	)
	.bind(transactionId)
	.first();
	if (!data) return error(404, 'Transaction Not Found');
	if (data.twitter_id !== twitterId || data.wallet_address !== account.address) return error(401, 'Unauthorized');
	console.log("data: ", data);

	return data;
}

router
	// .get('*', isAuthorized)
	.get('/getPairAddress/:tokenAddress', getPairAddress)
	.post('/buy', buy)
	.post('/sell', sell)
	.post('/approve', approve)
	.post('/getTransaction', isTwitterBot, getTransaction)

export default {
	fetch: (request: IRequest, env: Env, ctx: ExecutionContext) => router
		.handle(request, env, ctx)
		.then(json)
		.catch(error)
};
