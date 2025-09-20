/**
 * SafeSpot Sentinel Global V2 - Fastify Plugins Registration
 * Security-first plugin configuration with enterprise features
 */

import { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { authMiddleware } from '../middleware/auth.js';

/**
 * Register all Fastify plugins
 */
export async function registerPlugins(app: FastifyInstance): Promise<void> {
  // Security headers
  const helmet = (await import('@fastify/helmet')).default;
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ['\'self\''],
        styleSrc: ['\'self\'', '\'unsafe-inline\'', 'https:'],
        scriptSrc: ['\'self\'', '\'unsafe-eval\''],
        imgSrc: ['\'self\'', 'data:', 'https:'],
        connectSrc: ['\'self\'', 'wss:', 'https:'],
        fontSrc: ['\'self\'', 'https:'],
        objectSrc: ['\'none\''],
        mediaSrc: ['\'self\'', 'https:'],
        frameSrc: ['\'none\''],
        frameAncestors: ['\'none\''],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding for maps
  });

  // Cookie support (for CSRF double-submit and refresh token cookie)
  const cookie = (await import('@fastify/cookie')).default;
  await app.register(cookie, {
    hook: 'onRequest',
    secret: config.security.encryption.key,
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.app.isProduction,
    },
  });

  // CORS configuration (strict)
  const cors = (await import('@fastify/cors')).default;
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow server-to-server
      const allowed = config.server.corsOrigins.includes('*') || config.server.corsOrigins.includes(origin);
      cb(allowed ? null : new Error('CORS not allowed'), allowed);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Request-ID',
      'X-API-Key',
      'X-CSRF-Token',
    ],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  });

  // Rate limiting
  const rateLimit = (await import('@fastify/rate-limit')).default as any;
  await app.register(rateLimit, {
    max: config.security.rateLimit.max,
    timeWindow: config.security.rateLimit.window,
    skipSuccessfulRequests: true,
    skipOnError: true,
    keyGenerator: (request: any) => {
      return (request.headers['x-forwarded-for'] as string) || request.ip;
    },
    errorResponseBuilder: (request: any, context: any) => {
      return {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
          retryAfter: Math.round(context.ttl / 1000),
        },
      };
    },
  });

  // Redis connection
  const fastifyRedis = (await import('@fastify/redis')).default as any;
  await app.register(fastifyRedis, {
    url: config.redis.url,
    lazyConnect: true,
  });

  // JWT authentication
  const fastifyJwt = (await import('@fastify/jwt')).default as any;
  await app.register(fastifyJwt, {
    secret: config.security.jwt.secret,
    sign: {
      algorithm: 'HS256',
      expiresIn: config.security.jwt.accessExpiresIn,
    },
    verify: {
      algorithms: ['HS256'],
    },
  });

  // Decorate fastify with an `authenticate` preHandler that enforces auth on a route
  app.decorate('authenticate', async (request: any, reply: any) => {
    request.requireAuth = true;
    await authMiddleware(request, reply);
  });

  // Multipart support for file uploads
  const fastifyMultipart = (await import('@fastify/multipart')).default as any;
  await app.register(fastifyMultipart, {
    limits: {
      fieldNameSize: 100,
      fieldSize: 100,
      fields: 10,
      fileSize: config.storage.media.maxSize,
      files: 5,
      headerPairs: 2000,
    },
  });

  // WebSocket support
  const fastifyWebsocket = (await import('@fastify/websocket')).default as any;
  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: 1024 * 1024, // 1MB max payload
      verifyClient: (info: any) => {
        // Basic verification - will be enhanced in WebSocket handler
        return true;
      },
    },
  });

  // Swagger documentation
  if (config.app.isDevelopment) {
    const fastifySwagger = (await import('@fastify/swagger')).default as any;
    await app.register(fastifySwagger, {
      openapi: {
        openapi: '3.0.0',
        info: {
          title: 'SafeSpot Sentinel Global API',
          description: 'Enterprise security platform with real-time features',
          version: config.app.version,
          contact: {
            name: 'SafeSpot Sentinel Global',
            email: 'api@safespot.com',
          },
        },
        servers: [
          {
            url: `http://localhost:${config.server.port}`,
            description: 'Development server',
          },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
        security: [{ bearerAuth: [] }],
        tags: [
          { name: 'Auth', description: 'Authentication and authorization' },
          { name: 'Users', description: 'User management' },
          { name: 'Reports', description: 'Community reports and incidents' },
          { name: 'SOS', description: 'Emergency SOS system' },
          { name: 'Payments', description: 'Subscription and billing' },
          { name: 'Admin', description: 'Administrative functions' },
        ],
      },
    });

    const fastifySwaggerUi = (await import('@fastify/swagger-ui')).default as any;
    await app.register(fastifySwaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
      staticCSP: true,
    });
  }

  // Sensible defaults (better error handling)
  const fastifySensible = (await import('@fastify/sensible')).default as any;
  await app.register(fastifySensible, {
    errorHandler: true,
  });

  logger.info('✅ All Fastify plugins registered');
}