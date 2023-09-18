import { error, type IRequest } from 'itty-router'
import { twitterBotAbi } from './abis/twitterBot'
import { RequestBody, Env, WETH, TRANSFER, uniswap, getAmountOut, getBasisPointsMultiplier, bigintTransform, V2_ROUTER, uint256Max, USDC } from './helpers'
import { fetchTokenBalance, getReserves, fetchSymbol, getAccount, setupViemClient, fetchPairAddress } from './contractMethods'

// @param ethAmount will be in ether
// @param slippage will be in the percentage form (ie: 5% => 0.05)
export const buy = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	try {
		console.log("buy functionality accessed");
		const { twitterId, tokenAddress, amount, slippage, decimals, tokenPrice } = request.data as RequestBody;
		console.log("request data: ", request.data);
		const { account, client } = await setupViemClient(twitterId, env);
		console.log("client setup");
		console.log("account: ", account.address);

		const amountIn = BigInt(amount);
		const pair = await fetchPairAddress(tokenAddress, env);
		const token = await getReserves(tokenAddress, pair, env);
		const symbol = await fetchSymbol(tokenAddress, env);

		const amountOut = getAmountOut(amountIn, token.wethReserves, token.tokenReserves);
		const bp = getBasisPointsMultiplier(slippage);
		const amountOutMin = amountOut * BigInt((100 - slippage) * bp) / BigInt(100 * bp);
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
		console.log("tx hash: ", txHash);
		// const receipt = await client.waitForTransactionReceipt({ 
		// 	hash: txHash,
		// 	// confirmations: 2, MAY NEED TO ENABLE THIS IN THE FUTURE
		// })
		// console.log("transaction completed with txHash: ", txHash);

		// const log = receipt.logs
		// 	.find((log) => log.address === tokenAddress.toLowerCase() 
		// 		&& log.topics[0] === TRANSFER
		// 		&& `0x${log.topics[1]?.slice(-40)}` === pair.toLowerCase()
		// 		&& `0x${log.topics[2]?.slice(-40)}` === account.address.toLowerCase()
		// 	)
		// if (!log) return error(500, 'Unable to locate transfer event');
		// const transferredAmount = BigInt(log.data)
		// console.log("log parsed from receipt: ", JSON.stringify(bigintTransform(log), null, 2));

		// // load this data into d1
		// const results = await env.DB.prepare(
		// 	'INSERT INTO Transactions(id, hash, wallet_address, twitter_id, token_address, token_price, decimals, symbol, amount_in, amount_out, swap_type, block_number) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		// )
		// 	.bind(keccak256(stringToHex(crypto.randomUUID())), txHash, account.address, twitterId, tokenAddress, tokenPrice, decimals, symbol, numberToBytes(amountIn, { size: 32 }), numberToBytes(transferredAmount, { size: 32 }), 'BUY', Number(log.blockNumber))
		// 	.run();
		// console.log("database updated with results: ", results);

		return txHash;
	} catch (err: any) {
		console.log("err: ", err)
		return error(500, err.message);
	}
}

// @param ethAmount will be in ether
// @param slippage will be in the percentage form (ie: 5% => 0.05)
export const sell = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	try {
		console.log("sell functionality accessed");
		const { twitterId, tokenAddress, amount, slippage, decimals, tokenPrice } = request.data as RequestBody;
		console.log("amount: ", amount);
		const { account, client } = await setupViemClient(twitterId, env);
		console.log("client setup");

		const tokenBalance = await fetchTokenBalance(account.address, tokenAddress, env);
		console.log("token balance: ", tokenBalance.toString());
		const amountIn = BigInt(amount);
		const pair = await fetchPairAddress(tokenAddress, env);
		const token = await getReserves(tokenAddress, pair, env);

		const amountOut = getAmountOut(amountIn, token.tokenReserves, token.wethReserves);
		const bp = getBasisPointsMultiplier(slippage);
		const amountOutMin = amountOut * BigInt((100 - slippage) * bp) / BigInt(100 * bp);
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
		// const receipt = await client.waitForTransactionReceipt({ 
		// 	hash: txHash,
		// 	// confirmations: 2, MAY NEED TO ENABLE THIS IN THE FUTURE
		// })
		// console.log("transaction completed with receipt: ", txHash);

		// const log = receipt.logs
		// 	.find((log) => log.address === WETH.toLocaleLowerCase()
		// 		&& log.topics[0] === TRANSFER
		// 		&& `0x${log.topics[1]?.slice(-40)}` === pair.toLowerCase()
		// 		&& `0x${log.topics[2]?.slice(-40)}` === V2_ROUTER.toLowerCase()
		// 	)
		// if (!log) return error(500, 'Unable to locate transfer event');
		// const transferredAmount = BigInt(log.data)
		// console.log("log parsed from receipt: ", JSON.stringify(bigintTransform(log), null, 2));

		// const results = await env.DB.prepare(
		// 	'INSERT INTO Transactions(id, hash, wallet_address, twitter_id, token_address, token_price, decimals, symbol, amount_in, amount_out, swap_type, block_number) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		// )
		// 	.bind(keccak256(stringToHex(crypto.randomUUID())), txHash, account.address, twitterId, tokenAddress, tokenPrice, decimals, symbol, numberToBytes(amountIn, { size: 32 }), numberToBytes(transferredAmount, { size: 32 }), 'SELL', Number(log.blockNumber))
		// 	.run();
		// console.log("database updated with results: ", results);

		return txHash;
	} catch (err: any) {
		console.log("error: ", err);
		return error(500, err.message);
	}
}

export const approve = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	try {
		const { twitterId, tokenAddress } = request.data as RequestBody;
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

		return txHash;
	} catch (err: any) {
		return error(500, err.message);
	}
}

type TransactionBody = {
	twitterId: string;
	transactionId: string;
}
export const getTransaction = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	const { twitterId, transactionId } = await request.json() as TransactionBody;
	const account = await getAccount(twitterId, env);

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

export const getAddress = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	const { twitterId } = request.data as { twitterId: string; }
	console.log("request data: ", request.data);
	const account = await getAccount(twitterId, env);

	return { address: account.address };
}
