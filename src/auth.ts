
import { generatePrivateKey } from 'viem/accounts';
import { error } from 'itty-router';
import { Env } from './helpers'
import jwt from '@tsndr/cloudflare-worker-jwt'

export const fetchAccessToken = async (request: Request, env: Env, ctx: ExecutionContext) => {
	const { twitterId } = (await request.json()) as { twitterId: string };
	console.log("twitter Id in fetching: ", twitterId);

	let privateKey = await env.keys.get(twitterId);
	console.log("private key outside: ", privateKey);

	if (!privateKey) {
		privateKey = generatePrivateKey();
		await env.keys.put(twitterId, privateKey);
	}

  const token = await jwt.sign({ twitterId, exp: Math.floor(Date.now() / 1000) + (60 * 60) }, `${privateKey}_access`)
	const refreshToken = await jwt.sign({ twitterId, exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) }, `${privateKey}_refresh`)

	console.log("token: ", token);
	console.log("refresh token: ", refreshToken);

	return { token, refreshToken}
}

export const refreshAccessToken = async (request: Request, env: Env, ctx: ExecutionContext) => {
	try {
		const { refreshToken, twitterId } = (await request.json()) as { refreshToken: string; twitterId: string };
		const privateKey = await env.keys.get(twitterId);

		if (refreshToken && privateKey) {
			const isValid = await jwt.verify(refreshToken, `${privateKey!}_refresh`)
			if (isValid) {
				const token = await jwt.sign({ twitterId, exp: Math.floor(Date.now() / 1000) + (60 * 60) }, `${privateKey!}_access`)
				const refreshToken = await jwt.sign({ twitterId, exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) }, `${privateKey!}_refresh`)

				console.log("token: ", token)
				console.log("refreshToken: ", refreshToken)

				return { token, refreshToken }
			} else {
				return error(403, 'Invalid refresh token');
			}
		}
	} catch (err) {
		 return err;
	}
}

export const testAccessToken = async (request: Request, env: Env, ctx: ExecutionContext) => {
	try {
		const { token, twitterId } = (await request.json()) as { token: string; twitterId: string };
		const privateKey = await env.keys.get(twitterId);
		console.log("token in testing: ", token);
		console.log("twitter id testing : ", twitterId);
		console.log("private key: ", privateKey);

		if (token && privateKey) {
			const isValid = await jwt.verify(token, `${privateKey}_access`)
			if (!isValid) {
				console.log("should error out")
				return error(403, 'Invalid access token');
			} else {
				return { isValid }
			}
		}
	} catch (err) {
		return err;
	}
}
