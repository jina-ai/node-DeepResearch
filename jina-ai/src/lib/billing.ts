import { HTTPService } from 'civkit/http';
import _ from 'lodash';
import { Agent, RetryAgent } from 'undici';

export interface JinaWallet {
    trial_balance: number;
    trial_start: Date;
    trial_end: Date;
    regular_balance: number;
    total_balance: number;
}

export interface JinaUserBrief {
    user_id: string;
    wallet: JinaWallet;
    metadata: {
        [k: string]: any;
    };
}

export interface JinaUsageReport {
    model_name: string;
    request_path: string;
    user_id?: string;
    num_request: number;
    num_token: number;
}

const retryAgent = new RetryAgent(
    new Agent({
        allowH2: true
    }),
    {
        statusCodes: [429, 503],
        maxRetries: 2,
        retryAfter: true,
        minTimeout: 100,
    }
);

interface SefoAuthentication {
    user: {
        id: string;
        tier: number;
    };
    wallet: {
        total_balance: number;
    } | null;
}

export class SefoBillingHTTP extends HTTPService {
    name = 'SefoBillingHTTP';

    constructor(
        public baseUri: string = process.env.OVERRIDE_SEFO_BILLING_URL || 'https://sefo-lb-dev.jina.ai'
    ) {
        super(baseUri);

        Reflect.set(this.baseOptions, 'dispatcher', retryAgent);
        this.baseOptions.timeout = 30_000;  // 30 sec
    }

    async validateToken(token: string) {
        const r = await this.getWithSearchParams<SefoAuthentication>('/authentication', {
            force: true
        }, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        const { user, wallet } = r.data;

        return {
            data: {
                user_id: user.id,
                // No wallet means no balance limit: the largest exact integer passes every `total_balance > 0`
                // check and stays exact through local debits and JSON/BSON round-trips.
                wallet: { total_balance: wallet ? wallet.total_balance : Number.MAX_SAFE_INTEGER },
                metadata: { speed_level: user.tier },
            }
        };
    }

    async reportUsage(_token: string, query: JinaUsageReport) {
        // retryAgent never retries POST (not among undici's default retry methods). /usage has no
        // idempotency key, so a retry would be a second debit.
        const r = await this.postJson('/usage', {
            user_id: query.user_id,
            model_name: query.model_name,
            request_path: query.request_path,
            num_request: query.num_request,
            num_token: query.num_token,
        });

        return r;
    }
}
