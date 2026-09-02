import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

type CacheService = {
  get(args: { key: string }): Promise<unknown>
  set(args: { key: string; data: unknown; ttl?: number }): Promise<unknown>
}

type CachedResponse = {
  status: number
  body: unknown
}

const CACHE_TTL = Number(process.env.CACHE_TTL ?? 60)
const CACHE_PREFIX = "medusa:http:"

const CACHEABLE = new RegExp(
  "^/store/(products|product-categories|product-tags|product-types|collections|regions|currencies)(/.*)?$"
)

function cacheKey(req: MedusaRequest): string {
  const publishableKey = req.headers["x-publishable-api-key"] ?? "none"
  return `${CACHE_PREFIX}${req.originalUrl}::sk=${publishableKey}`
}

async function httpCacheMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  if (req.method !== "GET" || !CACHEABLE.test(req.path)) {
    return next()
  }

  let cache: CacheService | undefined
  try {
    cache = req.scope.resolve(Modules.CACHING) as unknown as CacheService
  } catch {
    return next()
  }

  const key = cacheKey(req)

  try {
    const entry = (await cache.get({ key })) as CachedResponse | undefined
    if (entry) {
      res.setHeader("x-medusa-cache", "HIT")
      res.status(entry.status ?? 200)
      res.json(entry.body)
      return
    }
  } catch (err) {
    res.setHeader("x-medusa-cache", "ERR")
    return next()
  }

  res.setHeader("x-medusa-cache", "MISS")
  const originalJson = res.json.bind(res)
  res.json = (body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      cache
        .set({
          key,
          data: { status: res.statusCode, body } satisfies CachedResponse,
          ttl: CACHE_TTL,
        })
        .catch((e: unknown) =>
          console.warn(`[http-cache] set failed:`, (e as Error)?.message)
        )
    }
    return originalJson(body)
  }

  return next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: /^\/store\//,
      method: "GET",
      middlewares: [httpCacheMiddleware],
    },
  ],
})