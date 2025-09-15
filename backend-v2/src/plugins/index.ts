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
export async function registerPlugins(app: FastifyInstance): Promise&lt;void&gt; {
  // Security headers
  await app.register(import('@fastify/helmet'), {
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

  // CORS configuration
  await app.register(import('@fastify/cors'), {
    origin: config.server.corsOrigins.includes('*') 
      ? true 
      : config.server.corsOrigins,
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
  });

  // Rate limiting
  await app.register(import('@fastify/rate-limit'), {
    max: config.security.rateLimit.max,
    timeWindow: config.security.rateLimit.window,
    skipSuccessfulRequests: true,
    skipOnError: true,
    keyGenerator: (request) =&gt; {
      return (request.headers['x-forwarded-for'] as string) || request.ip;
    },
    errorResponseBuilder: (request, context) =&gt; {
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
  await app.register(import('@fastify/redis'), {
    url: config.redis.url,
    lazyConnect: true,
  });

  // JWT authentication
  await app.register(import('@fastify/jwt'), {
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
  app.decorate('authenticate', async (request: any, reply: any) =&gt; {
    request.requireAuth = true;
    await authMiddleware(request, reply);
  });

  // Multipart support for file uploads
  await app.register(import('@fastify/multipart'), {
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
  await app.register(import('@fastify/websocket'), {
    options: {
      maxPayload: 1024 * 1024, // 1MB max payload
      verifyClient: (info) =&gt; {
        // Basic verification - will be enhanced in WebSocket handler
        return true;
      },
    },
  });

  // Swagger documentation
  if (config.app.isDevelopment) {
    await app.register(import('@fastify/swagger'), {
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

    await app.register(import('@fastify/swagger-ui'), {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
      staticCSP: true,
    });
  }

  // Sensible defaults (better error handling)
  await app.register(import('@fastify/sensible'), {
    errorHandler: true,
  });

  logger.info('✅ All Fastify plugins registered');
}