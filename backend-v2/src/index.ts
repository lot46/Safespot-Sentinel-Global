/**
 * SafeSpot Sentinel Global V2 - Main Application Entry Point
 * Enterprise-grade security app with PostgreSQL, PostGIS, WebSocket, OAuth2, 2FA, RBAC
 */

import Fastify from 'fastify';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { initializeDatabase } from './database/index.js';
import { initializeRedis } from './cache/redis.js';
import { registerPlugins } from './plugins/index.js';
import { registerRoutes } from './routes/index.js';
import { initializeWebSocket } from './websocket/index.js';
import { startSchedulers } from './schedulers/index.js';
import { initializeObservability } from './observability/index.js';

/**
 * Build Fastify application with all plugins and routes
 */
async function buildApp() {
  const app = Fastify({
    logger: logger,
    trustProxy: true,
    bodyLimit: config.server.maxPayloadSize,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId',
    genReqId: () => crypto.randomUUID(),
  });

  // Initialize observability first
  await initializeObservability();

  // Initialize external dependencies
  await initializeDatabase();
  await initializeRedis();

  // Register core plugins
  await registerPlugins(app);

  // Register routes
  await registerRoutes(app);

  // Initialize WebSocket
  await initializeWebSocket(app);

  return app;
}

/**
 * Start the application server
 */
async function start() {
  try {
    logger.info('🚀 Starting SafeSpot Sentinel Global V2...');

    const app = await buildApp();

    // Start schedulers (weather updates, data cleanup, etc.)
    await startSchedulers();

    // Start server
    const address = await app.listen({
      port: config.server.port,
      host: config.server.host,
    });

    logger.info(`✅ SafeSpot Sentinel Global V2 running at ${address}`);
    logger.info(`📊 Prometheus metrics: ${address}/metrics`);
    logger.info(`📖 API documentation: ${address}/docs`);
    logger.info(`🔍 Health check: ${address}/health`);

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`🛑 Received ${signal}, starting graceful shutdown...`);
      
      try {
        await app.close();
        logger.info('✅ Server closed successfully');
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// Handle unhandled rejections and exceptions
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the application
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}