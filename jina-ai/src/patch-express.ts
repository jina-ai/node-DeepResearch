import { ApplicationError, OperationNotAllowedError, Prop, RPC_CALL_ENVIRONMENT } from "civkit/civ-rpc";
import { marshalErrorLike } from "civkit/lang";
import { randomUUID } from "crypto";
import { once } from "events";
import type { NextFunction, Request, Response } from "express";

import { JinaEmbeddingsAuthDTO } from "./dto/jina-embeddings-auth";
import rateLimitControl, { API_CALL_STATUS, APICall, RateLimitDesc } from "./rate-limit";
import asyncLocalContext from "./lib/async-context";
import globalLogger from "./lib/logger";
import { InsufficientBalanceError } from "./lib/errors";
import { firebaseDefaultBucket, FirestoreRecord } from "./lib/firestore";
import cors from "cors";

globalLogger.serviceReady();
const logger = globalLogger.child({ service: 'JinaAISaaSMiddleware' });
const appName = 'DEEPRESEARCH';

export class KnowledgeItem extends FirestoreRecord {
    static override collectionName = 'knowledgeItems';

    @Prop({
        required: true
    })
    traceId!: string;

    @Prop({
        required: true
    })
    uid!: string;

    @Prop({
        default: ''
    })
    question!: string;

    @Prop({
        default: ''
    })
    answer!: string;

    @Prop({
        default: ''
    })
    type!: string;

    @Prop({
        arrayOf: Object,
        default: []
    })
    references!: any[];

    @Prop({
        defaultFactory: () => new Date()
    })
    createdAt!: Date;

    @Prop({
        defaultFactory: () => new Date()
    })
    updatedAt!: Date;
}
const corsMiddleware = cors();
export const jinaAiMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/ping') {
        res.status(200).end('pone');
        return;
    }
    if (req.path.startsWith('/v1/models')) {
        next();
        return;
    }
    if (req.method !== 'POST' && req.method !== 'GET') {
        next();
        return;
    }

    // Early API key validation - reject immediately if no valid auth header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        corsMiddleware(req, res, () => {
            res.status(401).json({ error: 'Unauthorized: API key required' });
        });
        return;
    }

    asyncLocalContext.run(async () => {
        const googleTraceId = req.get('x-cloud-trace-context')?.split('/')?.[0];
        const ctx = asyncLocalContext.ctx;
        ctx.traceId = req.get('x-request-id') || req.get('request-id') || googleTraceId || randomUUID();
        ctx.traceT0 = new Date();
        ctx.ip = req?.ip;

        try {
            const authDto = JinaEmbeddingsAuthDTO.from({
                [RPC_CALL_ENVIRONMENT]: { req, res }
            });

            const uid = await authDto.assertUID();
            // if (!uid && !ctx.ip) {
            //     throw new OperationNotAllowedError(`Missing IP information for anonymous user`);
            // }
            let rateLimitPolicy
            if (uid) {
                const user = await authDto.assertUser();
                if (!(user.wallet.total_balance > 0)) {
                    throw new InsufficientBalanceError(`Account balance not enough to run this query, please recharge.`);
                }
                rateLimitPolicy = authDto.getRateLimits(appName) || [
                    parseInt(user.metadata?.speed_level) >= 2 ?
                        RateLimitDesc.from({
                            occurrence: 500,
                            periodSeconds: 60
                        }) :
                        RateLimitDesc.from({
                            occurrence: 50,
                            periodSeconds: 60
                        })
                ];
            } else {
                rateLimitPolicy = [
                    RateLimitDesc.from({
                        occurrence: 0,
                        periodSeconds: 120
                    })
                ]
            }

            const criterions = rateLimitPolicy.map((c) => rateLimitControl.rateLimitDescToCriterion(c));
            await Promise.all(
                criterions.map(
                    ([pointInTime, n]) => uid ?
                        rateLimitControl.assertUidPeriodicLimit(uid, pointInTime, n, appName) :
                        rateLimitControl.assertIPPeriodicLimit(ctx.ip!, pointInTime, n, appName)
                )
            );
            const draftApiCall: Partial<APICall> = { tags: [appName] };
            if (uid) {
                draftApiCall.uid = uid;
            } else {
                draftApiCall.ip = ctx.ip;
            }

            const apiRoll = rateLimitControl.record(draftApiCall);
            apiRoll.save().catch((err) => logger.warn(`Failed to save rate limit record`, { err: marshalErrorLike(err) }));

            const pResClose = once(res, 'close');

            next();

            await pResClose;
            const chargeAmount = ctx.chargeAmount;
            if (chargeAmount) {
                authDto.reportUsage(chargeAmount, `reader-${appName}`).catch((err) => {
                    logger.warn(`Unable to report usage for ${uid || ctx.ip}`, { err: marshalErrorLike(err) });
                });
                apiRoll.chargeAmount = chargeAmount;
            }
            apiRoll.status = res.statusCode === 200 ? API_CALL_STATUS.SUCCESS : API_CALL_STATUS.ERROR;
            apiRoll.save().catch((err) => logger.warn(`Failed to save rate limit record`, { err: marshalErrorLike(err) }));
            logger.info(`HTTP ${res.statusCode} for request ${ctx.traceId} after ${Date.now() - ctx.traceT0.valueOf()}ms`, {
                uid,
                ip: ctx.ip,
                chargeAmount,
            });

            if (uid && ctx.promptContext?.knowledge?.length) {
                Promise.all(ctx.promptContext.knowledge.map((x: any) => KnowledgeItem.save(
                    KnowledgeItem.from({
                        ...x,
                        uid,
                        traceId: ctx.traceId,
                    })
                ))).catch((err: any) => {
                    logger.warn(`Failed to save knowledge`, { err: marshalErrorLike(err) });
                });
            }
            if (ctx.promptContext) {
                const patchedCtx = { ...ctx.promptContext };
                if (Array.isArray(patchedCtx.context)) {
                    patchedCtx.context = patchedCtx.context.map((x: object) => ({ ...x, result: undefined }))
                }

                let data;
                try {
                    data = JSON.stringify(patchedCtx);
                } catch (err: any) {
                    const obj = marshalErrorLike(err);
                    if (err.stack) {
                        obj.stack = err.stack;
                    }
                    data = JSON.stringify(obj);
                    logger.warn(`Failed to stringify promptContext`, { err: obj });
                }

                firebaseDefaultBucket.file(`promptContext/${ctx.traceId}.json`).save(
                    data,
                    {
                        metadata: {
                            contentType: 'application/json',
                        },
                    }
                ).catch((err: any) => {
                    logger.warn(`Failed to save promptContext`, { err: marshalErrorLike(err) });
                }).finally(() => {
                    ctx.promptContext = undefined;
                });
            }

        } catch (err: any) {
            if (!res.headersSent) {
                corsMiddleware(req, res, () => 'noop');
                if (err instanceof ApplicationError) {
                    res.status(parseInt(err.code as string) || 500).json({ error: err.message });

                    return;
                }

                res.status(500).json({ error: 'Internal' });
            }

            logger.error(`Error in billing middleware`, { err: marshalErrorLike(err) });
            if (err.stack) {
                logger.error(err.stack);
            }
        }

    });
}