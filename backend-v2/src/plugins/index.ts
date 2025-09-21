/**
 * SafeSpot Sentinel Global V2 - Fastify Plugins Registration
 * Security-first plugin configuration with enterprise features
 */

import { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { authMiddleware } from '../middleware/auth.js';

export async function registerPlugins(app: FastifyInstance): Promise<void> {
  app.decorate('config', config as any);

  const helmet = (await import('@fastify/helmet')).default;
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https:'], scriptSrc: ["'self'", "'unsafe-eval'"], imgSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'", 'wss:', 'https:'], fontSrc: ["'self'", 'https:'], objectSrc: ["'none'"], mediaSrc: ["'self'", 'https:'], frameSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginEmbedderPolicy: false } as any);

  const cookie = (await import('@fastify/cookie')).default as any;
  await app.register(cookie, { hook: 'onRequest', secret: config.security.encryption.key, parseOptions: { httpOnly: true, sameSite: 'lax', secure: config.app.isProduction } } as any);

  const cors = (await import('@fastify/cors')).default as any;
  await app.register(cors, { origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => { if (!origin) return cb(null, true); const allowed = config.server.corsOrigins.includes('*') || config.server.corsOrigins.includes(origin); cb(allowed ? null : new Error('CORS not allowed'), allowed); }, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Origin','X-Requested-With','Content-Type','Accept','Authorization','X-Request-ID','X-API-Key','X-CSRF-Token'], exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'] } as any);

  const rateLimit = (await import('@fastify/rate-limit')).default as any;
  await app.register(rateLimit, { max: config.security.rateLimit.max, timeWindow: config.security.rateLimit.window, skipSuccessfulRequests: true, skipOnError: true, keyGenerator: (request: any) => (request.headers['x-forwarded-for'] as string) || request.ip, errorResponseBuilder: (_request: any, context: any) => ({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later', retryAfter: Math.round(context.ttl / 1000) } }) } as any);

  // Raw body plugin for Stripe webhook signature verification
  try {
    const rawBody = (await import('@fastify/raw-body')).default as any;
    await app.register(rawBody, { field: 'rawBody', global: true, encoding: 'utf8', runFirst: true } as any);
  } catch (e) {
    logger.warn('raw-body plugin not available; Stripe webhook requires raw body to verify signatures');
  }

  const fastifyRedis = (await import('@fastify/redis')).default as any;
  await app.register(fastifyRedis, { url: config.redis.url, lazyConnect: true } as any);

  const fastifyJwt = (await import('@fastify/jwt')).default as any;
  await app.register(fastifyJwt, { secret: config.security.jwt.secret, sign: { algorithm: 'HS256', expiresIn: config.security.jwt.accessExpiresIn }, verify: { algorithms: ['HS256'] } } as any);

  const fastifyMultipart = (await import('@fastify/multipart')).default as any;
  await app.register(fastifyMultipart, { limits: { fileSize: config.storage.media.maxSize, files: 5 } } as any);

  const fastifyWebsocket = (await import('@fastify/websocket')).default as any;
  await app.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } } as any);

  if (config.app.isDevelopment) {
    const fastifySwagger = (await import('@fastify/swagger')).default as any;
    await app.register(fastifySwagger, { openapi: { openapi: '3.0.0', info: { title: 'SafeSpot Sentinel Global API', version: config.app.version }, servers: [{ url: `http://localhost:${config.server.port}`, description: 'Development server' }], components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } }, security: [{ bearerAuth: [] }] } } as any);
    const fastifySwaggerUi = (await import('@fastify/swagger-ui')).default as any;
    await app.register(fastifySwaggerUi, { routePrefix: '/docs', staticCSP: true } as any);
  }

  const fastifySensible = (await import('@fastify/sensible')).default as any;
  await app.register(fastifySensible, { errorHandler: true } as any);

  if (!(app as any).authenticate) {
    app.decorate('authenticate', async (request: any, _reply: any) => { request.requireAuth = true; await authMiddleware(request, _reply); });
  }

  logger.info('✅ All Fastify plugins registered');
}