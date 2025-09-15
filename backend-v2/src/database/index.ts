/**
 * SafeSpot Sentinel Global V2 - Database Connection & Management
 * PostgreSQL + PostGIS with Prisma ORM
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

// Global Prisma instance
let prisma: PrismaClient;

/**
 * Get Prisma client singleton
 */
export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: config.app.isDevelopment 
        ? ['query', 'info', 'warn', 'error']
        : ['info', 'warn', 'error'],
      datasources: {
        db: {
          url: config.database.url,
        },
      },
    });

    // Add query logging middleware
    if (config.app.isDevelopment) {
      prisma.$use(async (params, next) => {
        const before = Date.now();
        const result = await next(params);
        const after = Date.now();
        
        logger.debug({
          model: params.model,
          action: params.action,
          duration: after - before,
        }, `Database query: ${params.model}.${params.action}`);
        
        return result;
      });
    }
  }
  
  return prisma;
}

/**
 * Initialize database connection
 */
export async function initializeDatabase(): Promise<void> {
  try {
    logger.info('🗄️  Connecting to PostgreSQL database...');
    
    const client = getPrisma();
    
    // Test connection
    await client.$connect();
    
    // Run database health check
    await client.$queryRaw`SELECT 1 as health_check`;
    
    // Check PostGIS extension
    const postgisVersion = await client.$queryRaw`SELECT PostGIS_Version() as version`;
    logger.info(`✅ PostgreSQL connected with PostGIS: ${(postgisVersion as any)[0]?.version}`);
    
    // Run pending migrations in production
    if (config.app.isProduction) {
      logger.info('🔄 Running database migrations...');
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      await execAsync('npx prisma migrate deploy');
      logger.info('✅ Database migrations completed');
    }
    
  } catch (error) {
    logger.error('❌ Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Disconnect from database
 */
export async function disconnectDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    logger.info('🗄️  Database disconnected');
  }
}

/**
 * Database health check
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = getPrisma();
    await client.$queryRaw`SELECT 1 as health`;
    return true;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
}

/**
 * Get database statistics
 */
export async function getDatabaseStats(): Promise<{
  totalUsers: number;
  totalReports: number;
  activeSosSessions: number;
  premiumUsers: number;
}> {
  const client = getPrisma();
  
  const [
    totalUsers,
    totalReports,
    activeSosSessions,
    premiumUsers,
  ] = await Promise.all([
    client.user.count({ where: { deletedAt: null } }),
    client.report.count({ where: { deletedAt: null } }),
    client.sOSSession.count({ where: { state: 'ACTIVE' } }),
    client.user.count({ where: { isPremium: true, deletedAt: null } }),
  ]);

  return {
    totalUsers,
    totalReports,
    activeSosSessions,
    premiumUsers,
  };
}

// Export the singleton
export { prisma };