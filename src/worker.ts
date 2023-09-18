import { Router, error, json, createCors, type IRequest } from 'itty-router'
import { Env, isAuthorized, isTwitterBot } from './helpers';
import { 
	buy,
	sell,
	approve,
	getAddress,
	getTransaction,
} from './transactions';
import {
	fetchAccessToken,
	refreshAccessToken,
	testAccessToken,
} from './auth'

const { preflight, corsify } = createCors()

const router = Router();

router
	.all('*', preflight)
	.post('/buy', isAuthorized, buy)
	.post('/sell', isAuthorized, sell)
	.post('/approve', isAuthorized, approve)
	.post('/getAddress', isAuthorized, getAddress)
	.post('/getTransaction', isTwitterBot, getTransaction)
  .post('/fetchAccessToken', isTwitterBot, fetchAccessToken)
  .post(
    '/refreshAccessToken',
		refreshAccessToken,
  )
	.post('/testAccessToken', testAccessToken)
  .all('*', () => error(404))

export default {
	fetch: (request: IRequest, env: Env, ctx: ExecutionContext) => router
		.handle(request, env, ctx)
		.then(json)
		.catch(error)
		.then(corsify)
};
