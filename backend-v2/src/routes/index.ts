/**
 * SafeSpot Sentinel Global V2 - Routes Registration
 * Modular API routes with proper error handling
 */

import { FastifyInstance } from 'fastify';
import { logger } from '../utils/logger.js';
import { authMiddleware, roleMiddleware, premiumMiddleware } from '../middleware/auth.js';

/**
 * Register all API routes
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Register global middleware
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', roleMiddleware);
  app.addHook('preHandler', premiumMiddleware);

  // Health check route (no auth required)
  app.get('/health', {
    schema: {
      tags: ['System'],
      summary: 'Health check endpoint',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            version: { type: 'string' },
            services: {
              type: 'object',
              properties: {
                database: { type: 'boolean' },
                redis: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { checkDatabaseHealth } = await import('../database/index.js');
    const { checkRedisHealth } = await import('../cache/redis.js');

    const [dbHealth, redisHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);

    const health = {
      status: dbHealth && redisHealth ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      services: {
        database: dbHealth,
        redis: redisHealth,
      },
    };

    const statusCode = dbHealth && redisHealth ? 200 : 503;
    reply.code(statusCode).send(health);
  });

  // Metrics endpoint for Prometheus
  app.get('/metrics', async (request, reply) => {
    const { getDatabaseStats } = await import('../database/index.js');
    const { getRedisStats } = await import('../cache/redis.js');

    try {
      const [dbStats, redisStats] = await Promise.all([
        getDatabaseStats(),
        getRedisStats(),
      ]);

      // Simple Prometheus metrics format
      const metrics = [
        `# HELP safespot_users_total Total number of users`,
        `# TYPE safespot_users_total counter`,
        `safespot_users_total ${dbStats.totalUsers}`,
        ``,
        `# HELP safespot_reports_total Total number of reports`,
        `# TYPE safespot_reports_total counter`,
        `safespot_reports_total ${dbStats.totalReports}`,
        ``,
        `# HELP safespot_sos_active Active SOS sessions`,
        `# TYPE safespot_sos_active gauge`,
        `safespot_sos_active ${dbStats.activeSosSessions}`,
        ``,
        `# HELP safespot_premium_users Premium users count`,
        `# TYPE safespot_premium_users gauge`,
        `safespot_premium_users ${dbStats.premiumUsers}`,
        ``,
        `# HELP safespot_redis_connections Redis connections`,
        `# TYPE safespot_redis_connections gauge`,
        `safespot_redis_connections ${redisStats.connections}`,
      ].join('\n');

      reply.type('text/plain').send(metrics);
    } catch (error) {
      logger.error({ error }, 'Metrics generation failed');
      reply.code(500).send('Metrics unavailable');
    }
  });

  // API routes prefix
  await app.register(async (apiInstance) => {
    // CSRF protection preHandler for unsafe methods unless using Bearer auth
    const { csrfMiddleware } = await import('../middleware/auth.js');
    apiInstance.addHook('preHandler', csrfMiddleware as any);
    // Add authenticate decorator
    apiInstance.decorate('authenticate', (await import('../middleware/auth.js')).authMiddleware as any);
    
    // Authentication routes
    await apiInstance.register(
      (await import('./auth.js')).default,
      { prefix: '/auth' }
    );

    // User routes
    await apiInstance.register(
      (await import('./users.js')).default,
      { prefix: '/users' }
    );

    // Reports routes
    await apiInstance.register(
      (await import('./reports.js')).default,
      { prefix: '/reports' }
    );

    // SOS routes
    await apiInstance.register(
      (await import('./sos.js')).default,
      { prefix: '/sos' }
    );

    // Payments routes
    await apiInstance.register(
      (await import('./payments.js')).default,
      { prefix: '/payments' }
    );

    // Zones/Geography routes
    await apiInstance.register(
      (await import('./zones.js')).default,
      { prefix: '/zones' }
    );

    // Admin routes
    await apiInstance.register(
      (await import('./admin.js')).default,
      { prefix: '/admin' }
    );

    // Webhooks (no auth required)
    await apiInstance.register(
      (await import('./webhooks.js')).default,
      { prefix: '/webhooks' }
    );
  }, { prefix: '/api' });

  // Global error handler
  app.setErrorHandler(async (error, request, reply) => {
    // Log error with context
    logger.error('Request error:', {
      error: error.message,
      stack: error.stack,
      url: request.url,
      method: request.method,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      userId: request.user?.id,
    });

    // Don't expose internal errors in production
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    if (error.validation) {
      reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: isDevelopment ? error.validation : undefined,
        },
      });
    } else if (error.statusCode) {
      reply.code(error.statusCode).send({
        error: {
          code: error.code || 'REQUEST_ERROR',
          message: error.message,
        },
      });
    } else {
      reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: isDevelopment ? error.message : 'Internal server error',
          details: isDevelopment ? error.stack : undefined,
        },
      });
    }
  });

  // 404 handler
  app.setNotFoundHandler(async (request, reply) => {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        path: request.url,
      },
    });
  });

  logger.info('✅ All API routes registered');
}