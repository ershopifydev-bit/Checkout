/**
 * Centralized Shopify GraphQL client with per-merchant rate limiting,
 * cost tracking, bounded timeouts, and error classification.
 */

export interface ShopifyCostInfo {
  requestedQueryCost?: number | undefined;
  actualQueryCost?: number | undefined;
  currentlyAvailable?: number | undefined;
  maximumAvailable?: number | undefined;
  restoreRate?: number | undefined;
}

export class ShopifyClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(`[ShopifyClient] ${code}: ${message}`);
    this.name = 'ShopifyClientError';
  }
}

export class AmbiguousShopifyError extends ShopifyClientError {
  constructor(
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message, 'AMBIGUOUS_EXECUTION', 504);
    this.name = 'AmbiguousShopifyError';
  }
}

export class ShopifyThrottledError extends ShopifyClientError {
  constructor(
    message: string,
    public readonly retryAfterSeconds = 2,
  ) {
    super(message, 'SHOPIFY_THROTTLED', 429);
    this.name = 'ShopifyThrottledError';
  }
}

export class ShopifyValidationError extends ShopifyClientError {
  constructor(
    message: string,
    public readonly userErrors: Array<{ field?: string[] | null; message?: string }>,
  ) {
    super(message, 'SHOPIFY_VALIDATION_ERROR', 422);
    this.name = 'ShopifyValidationError';
  }
}

// In-memory per-shop rate-limit budget tracker
interface ShopApiBudget {
  currentlyAvailable: number;
  maximumAvailable: number;
  restoreRate: number;
  lastUpdated: number;
}

const shopBudgets = new Map<string, ShopApiBudget>();

function getShopBudget(shop: string): ShopApiBudget {
  const norm = shop.trim().toLowerCase();
  const existing = shopBudgets.get(norm);
  const now = Date.now();
  if (existing) {
    // Replenish based on restoreRate
    const elapsedSeconds = (now - existing.lastUpdated) / 1000;
    const restored = Math.floor(elapsedSeconds * existing.restoreRate);
    if (restored > 0) {
      existing.currentlyAvailable = Math.min(
        existing.maximumAvailable,
        existing.currentlyAvailable + restored,
      );
      existing.lastUpdated = now;
    }
    return existing;
  }
  // Default Shopify standard tier: 1000 max, 50/sec restore rate
  const initial: ShopApiBudget = {
    currentlyAvailable: 1000,
    maximumAvailable: 1000,
    restoreRate: 50,
    lastUpdated: now,
  };
  shopBudgets.set(norm, initial);
  return initial;
}

function updateShopBudget(shop: string, cost?: ShopifyCostInfo) {
  if (!cost) return;
  const norm = shop.trim().toLowerCase();
  const throttle = cost;
  if (throttle.currentlyAvailable != null) {
    shopBudgets.set(norm, {
      currentlyAvailable: throttle.currentlyAvailable,
      maximumAvailable: throttle.maximumAvailable ?? 1000,
      restoreRate: throttle.restoreRate ?? 50,
      lastUpdated: Date.now(),
    });
  }
}

export function getShopifyCostTracker(shop: string) {
  const b = getShopBudget(shop);
  return {
    availableBudget: b.currentlyAvailable,
    maxBudget: b.maximumAvailable,
    restoreRate: b.restoreRate,
  };
}

export function recordShopifyCost(shop: string, cost: ShopifyCostInfo) {
  updateShopBudget(shop, cost);
}

export function classifyGraphQLError(
  err: unknown,
  statusCode?: number,
  userErrors?: Array<{ field?: string[] | null; message?: string }>,
): ShopifyClientError {
  if (userErrors && userErrors.length > 0) {
    return new ShopifyValidationError(
      userErrors
        .map((u) => u.message)
        .filter(Boolean)
        .join('; ') || 'Shopify validation error',
      userErrors,
    );
  }
  if (statusCode === 429) {
    return new ShopifyThrottledError('Shopify rate limit exceeded (HTTP 429)', 2);
  }
  if (
    err instanceof Error &&
    (err.name === 'AbortError' || /ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR_SOCKET/i.test(err.message))
  ) {
    return new AmbiguousShopifyError(err.message, err);
  }
  if (statusCode && statusCode >= 500) {
    return new AmbiguousShopifyError(`Shopify server error (HTTP ${statusCode})`);
  }
  return new ShopifyClientError(
    err instanceof Error ? err.message : 'Shopify error',
    'GRAPHQL_ERROR',
    statusCode,
  );
}

export type ExecuteGraphQLOptions = {
  timeoutMs?: number | undefined;
  estimatedCost?: number | undefined;
  apiVersion?: string | undefined;
};

/**
 * Executes a Shopify GraphQL request with timeout, cost tracking, and error safety.
 */
export async function executeShopifyGraphQL<T = unknown>(
  shop: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  options: ExecuteGraphQLOptions = {},
): Promise<{ data: T; cost?: ShopifyCostInfo | undefined }> {
  const normShop = shop.trim().toLowerCase();
  if (!normShop) throw new ShopifyClientError('Shop domain required', 'INVALID_SHOP', 400);
  if (!token)
    throw new ShopifyClientError('Shopify access token required', 'ADMIN_TOKEN_MISSING', 401);

  // Check rate limit budget
  const budget = getShopBudget(normShop);
  const estimatedCost = options.estimatedCost ?? 15;
  if (budget.currentlyAvailable < estimatedCost) {
    const deficit = estimatedCost - budget.currentlyAvailable;
    const waitSec = Math.ceil(deficit / (budget.restoreRate || 50));
    throw new ShopifyThrottledError(
      `Shopify API capacity exceeded for ${normShop}. Retry after ${waitSec}s`,
      waitSec,
    );
  }

  const apiVersion = options.apiVersion || process.env['SHOPIFY_API_VERSION'] || '2026-10';
  const timeoutMs =
    options.timeoutMs ?? (Number(process.env['SHOPIFY_ORDER_CREATE_TIMEOUT_MS']) || 15000);
  const url = `https://${normShop}/admin/api/${apiVersion}/graphql.json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const error = err as Error;
    if (error.name === 'AbortError') {
      // TIMEOUT AFTER SENDING: We do NOT know if Shopify created the order!
      throw new AmbiguousShopifyError(
        `Shopify GraphQL request timed out after ${timeoutMs}ms for ${normShop}`,
        err,
      );
    }
    // Network socket drops / connection reset after socket opened
    if (/ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR_SOCKET/i.test(error.message)) {
      throw new AmbiguousShopifyError(
        `Shopify connection failed during communication: ${error.message}`,
        err,
      );
    }
    throw new ShopifyClientError(
      `Shopify network request failed: ${error.message}`,
      'NETWORK_FAILURE',
      502,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ShopifyClientError(
      `Shopify authentication failed (${response.status}) for ${normShop}`,
      'ADMIN_TOKEN_INVALID',
      response.status,
    );
  }

  if (response.status === 429) {
    const retryHeader = Number(response.headers.get('Retry-After')) || 2;
    throw new ShopifyThrottledError(`Shopify rate limit exceeded (HTTP 429)`, retryHeader);
  }

  if (response.status >= 500) {
    // 5xx from Shopify could mean the mutation succeeded or failed internally
    throw new AmbiguousShopifyError(
      `Shopify server error (HTTP ${response.status}) during GraphQL execution`,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ShopifyClientError(
      `Shopify HTTP ${response.status}: ${text.slice(0, 200)}`,
      'SHOPIFY_HTTP_ERROR',
      response.status,
    );
  }

  const json = (await response.json().catch(() => {
    throw new AmbiguousShopifyError('Shopify returned non-JSON response');
  })) as {
    data?: T | undefined;
    errors?: Array<{ message?: string | undefined }> | undefined;
    extensions?:
      | {
          cost?:
            | {
                requestedQueryCost?: number | undefined;
                actualQueryCost?: number | undefined;
                throttleStatus?:
                  | {
                      currentlyAvailable?: number | undefined;
                      maximumAvailable?: number | undefined;
                      restoreRate?: number | undefined;
                    }
                  | undefined;
              }
            | undefined;
        }
      | undefined;
  };

  const costInfo: ShopifyCostInfo | undefined = json.extensions?.cost
    ? {
        requestedQueryCost: json.extensions.cost.requestedQueryCost,
        actualQueryCost: json.extensions.cost.actualQueryCost,
        currentlyAvailable: json.extensions.cost.throttleStatus?.currentlyAvailable,
        maximumAvailable: json.extensions.cost.throttleStatus?.maximumAvailable,
        restoreRate: json.extensions.cost.throttleStatus?.restoreRate,
      }
    : undefined;

  updateShopBudget(normShop, costInfo);

  if (json.errors?.length) {
    const messages = json.errors.map((e) => e.message || '').join('; ');
    if (/throttled|rate limit/i.test(messages)) {
      throw new ShopifyThrottledError(`Shopify GraphQL throttled: ${messages}`);
    }
    throw new ShopifyClientError(
      `Shopify GraphQL execution error: ${messages}`,
      'GRAPHQL_ERROR',
      400,
    );
  }

  if (!json.data) {
    throw new ShopifyClientError('Shopify response missing data field', 'MISSING_DATA', 500);
  }

  return { data: json.data, cost: costInfo };
}
