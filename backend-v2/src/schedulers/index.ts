/**
 * SafeSpot Sentinel Global V2 - Background Schedulers
 * Automated tasks for data cleanup, weather updates, and maintenance
 */

import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { getPrisma } from '../database/index.js';
import { anonymizeData } from '../security/encryption.js';

const prisma = getPrisma();

interface SchedulerJob {
  name: string;
  interval: number; // milliseconds
  handler: () => Promise<void>;
  lastRun?: Date;
  nextRun?: Date;
}

class Scheduler {
  private jobs: Map<string, SchedulerJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  /**
   * Register a scheduled job
   */
  register(job: SchedulerJob): void {
    this.jobs.set(job.name, {
      ...job,
      nextRun: new Date(Date.now() + job.interval),
    });

    logger.info('Scheduler job registered', {
      name: job.name,
      interval: job.interval,
      nextRun: job.nextRun,
    });
  }

  /**
   * Start all scheduled jobs
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;

    for (const [name, job] of this.jobs) {
      const timer = setInterval(async () => {
        try {
          logger.debug('Running scheduled job', { name });
          const start = Date.now();
          
          await job.handler();
          
          const duration = Date.now() - start;
          job.lastRun = new Date();
          job.nextRun = new Date(Date.now() + job.interval);

          logger.info('Scheduled job completed', {
            name,
            duration,
            nextRun: job.nextRun,
          });

        } catch (error) {
          logger.error('Scheduled job failed', { name, error });
        }
      }, job.interval);

      this.timers.set(name, timer);
    }

    logger.info('Scheduler started', { jobCount: this.jobs.size });
  }

  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    if (!this.isRunning) return;

    for (const [name, timer] of this.timers) {
      clearInterval(timer);
    }

    this.timers.clear();
    this.isRunning = false;

    logger.info('Scheduler stopped');
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    jobs: Array<{
      name: string;
      interval: number;
      lastRun?: Date;
      nextRun?: Date;
    }>;
  } {
    return {
      isRunning: this.isRunning,
      jobs: Array.from(this.jobs.values()).map(job => ({
        name: job.name,
        interval: job.interval,
        lastRun: job.lastRun,
        nextRun: job.nextRun,
      })),
    };
  }
}

// Global scheduler instance
const scheduler = new Scheduler();

/**
 * Data cleanup job - GDPR compliance
 */
async function dataCleanupJob(): Promise<void> {
  const now = new Date();

  // 1. Anonymize old reports (18 months)
  const reportCutoff = new Date(now.getTime() - (config.gdpr.dataRetention.reportsMonths * 30 * 24 * 60 * 60 * 1000));
  
  const oldReports = await prisma.report.findMany({
    where: {
      createdAt: { lt: reportCutoff },
      deletedAt: null,
    },
    take: 100, // Process in batches
  });

  if (oldReports.length > 0) {
    for (const report of oldReports) {
      const anonymized = anonymizeData({
        description: report.description,
        address: report.address,
      });

      await prisma.report.update({
        where: { id: report.id },
        data: {
          description: anonymized.description,
          address: anonymized.address,
          userId: 'anonymous',
          mediaUrls: [], // Remove media URLs
        },
      });
    }

    logger.info('Reports anonymized', { count: oldReports.length });
  }

  // 2. Delete old SOS session location history (30 days)
  const sosCutoff = new Date(now.getTime() - (config.gdpr.dataRetention.sosSessionsDays * 24 * 60 * 60 * 1000));
  
  const oldSOSSessions = await prisma.sOSSession.updateMany({
    where: {
      endedAt: { lt: sosCutoff },
      state: { in: ['ENDED', 'CANCELLED'] },
    },
    data: {
      locationHistory: [],
      contactsNotified: [],
    },
  });

  if (oldSOSSessions.count > 0) {
    logger.info('SOS sessions cleaned up', { count: oldSOSSessions.count });
  }

  // 3. Delete old audit logs (6 months)
  const auditCutoff = new Date(now.getTime() - (config.gdpr.dataRetention.logsMonths * 30 * 24 * 60 * 60 * 1000));
  
  const deletedAuditLogs = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: auditCutoff },
    },
  });

  if (deletedAuditLogs.count > 0) {
    logger.info('Audit logs cleaned up', { count: deletedAuditLogs.count });
  }

  // 4. Clean up expired user sessions
  const sessionCutoff = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)); // 7 days
  
  const expiredSessions = await prisma.userSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { lastUsedAt: { lt: sessionCutoff } },
      ],
    },
  });

  if (expiredSessions.count > 0) {
    logger.info('Expired sessions cleaned up', { count: expiredSessions.count });
  }

  // 5. Clean up unverified users (30 days)
  const unverifiedCutoff = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  
  const unverifiedUsers = await prisma.user.deleteMany({
    where: {
      emailVerified: false,
      createdAt: { lt: unverifiedCutoff },
      lastLoginAt: null,
    },
  });

  if (unverifiedUsers.count > 0) {
    logger.info('Unverified users cleaned up', { count: unverifiedUsers.count });
  }
}

/**
 * Weather update job
 */
async function weatherUpdateJob(): Promise<void> {
  try {
    // This would integrate with OpenWeatherMap API
    // For now, we'll create mock weather zones
    
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    // Create a mock severe weather warning
    const mockWeatherZone = {
      name: 'Alerte Météo - Orage Sévère',
      level: 'ORANGE' as const,
      source: 'WEATHER' as const,
      description: 'Orages violents attendus avec risque de grêle et vents forts',
      geom: 'POLYGON((2.0 48.5, 2.5 48.5, 2.5 49.0, 2.0 49.0, 2.0 48.5))', // Paris area
      area: 2500000000, // ~2500 km²
      validFrom: now,
      validTo: oneHourFromNow,
      sourceId: 'OWM_' + Date.now(),
      sourceData: {
        provider: 'OpenWeatherMap',
        severity: 'moderate',
        phenomena: ['thunderstorm', 'hail', 'wind'],
        windSpeed: 80,
        visibility: 1000,
      },
    };

    // Check if similar zone already exists
    const existingZone = await prisma.zone.findFirst({
      where: {
        source: 'WEATHER',
        sourceId: mockWeatherZone.sourceId,
        isActive: true,
      },
    });

    if (!existingZone && Math.random() < 0.1) { // 10% chance to create weather alert
      await prisma.zone.create({
        data: mockWeatherZone,
      });

      logger.info('Weather zone created', {
        name: mockWeatherZone.name,
        level: mockWeatherZone.level,
        validFrom: mockWeatherZone.validFrom,
        validTo: mockWeatherZone.validTo,
      });
    }

    // Deactivate expired weather zones
    const expiredZones = await prisma.zone.updateMany({
      where: {
        source: 'WEATHER',
        validTo: { lt: now },
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    if (expiredZones.count > 0) {
      logger.info('Expired weather zones deactivated', { count: expiredZones.count });
    }

  } catch (error) {
    logger.error('Weather update job failed:', error);
  }
}

/**
 * Premium subscription check job
 */
async function premiumCheckJob(): Promise<void> {
  const now = new Date();

  // Find expired premium subscriptions
  const expiredPremiumUsers = await prisma.user.findMany({
    where: {
      isPremium: true,
      premiumUntil: { lt: now },
    },
    take: 100, // Process in batches
  });

  if (expiredPremiumUsers.length > 0) {
    // Update users to non-premium
    await prisma.user.updateMany({
      where: {
        id: { in: expiredPremiumUsers.map(u => u.id) },
      },
      data: {
        isPremium: false,
      },
    });

    logger.info('Premium subscriptions expired', { count: expiredPremiumUsers.length });

    // TODO: Send notification emails to users about subscription expiry
  }

  // Check for subscriptions expiring soon (7 days)
  const soonExpiring = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
  
  const expiringSoonUsers = await prisma.user.findMany({
    where: {
      isPremium: true,
      premiumUntil: {
        gte: now,
        lte: soonExpiring,
      },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      premiumUntil: true,
    },
  });

  if (expiringSoonUsers.length > 0) {
    logger.info('Premium subscriptions expiring soon', { count: expiringSoonUsers.length });
    
    // TODO: Send reminder emails
    for (const user of expiringSoonUsers) {
      logger.debug('Premium expiring soon', {
        userId: user.id,
        email: user.email,
        expiresAt: user.premiumUntil,
      });
    }
  }
}

/**
 * System maintenance job
 */
async function maintenanceJob(): Promise<void> {
  // 1. Update database statistics
  try {
    await prisma.$executeRaw`ANALYZE;`;
    logger.debug('Database statistics updated');
  } catch (error) {
    logger.warn('Failed to update database statistics:', error);
  }

  // 2. Clean up old security events
  const securityEventCutoff = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)); // 30 days
  
  const deletedSecurityEvents = await prisma.securityEvent.deleteMany({
    where: {
      createdAt: { lt: securityEventCutoff },
      resolved: true,
    },
  });

  if (deletedSecurityEvents.count > 0) {
    logger.info('Old security events cleaned up', { count: deletedSecurityEvents.count });
  }

  // 3. Performance monitoring
  const memUsage = process.memoryUsage();
  const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  if (memUsagePercent > 85) {
    logger.warn('High memory usage detected', {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      usagePercent: Math.round(memUsagePercent),
    });
  }

  // 4. Check for stuck SOS sessions (active for more than 24 hours)
  const stuckSOSCutoff = new Date(Date.now() - (24 * 60 * 60 * 1000));
  
  const stuckSessions = await prisma.sOSSession.findMany({
    where: {
      state: 'ACTIVE',
      startedAt: { lt: stuckSOSCutoff },
    },
  });

  if (stuckSessions.length > 0) {
    logger.warn('Stuck SOS sessions detected', { count: stuckSessions.length });
    
    // Auto-end stuck sessions
    await prisma.sOSSession.updateMany({
      where: {
        id: { in: stuckSessions.map(s => s.id) },
      },
      data: {
        state: 'ENDED',
        endedAt: new Date(),
      },
    });

    logger.info('Stuck SOS sessions auto-ended', { count: stuckSessions.length });
  }
}

/**
 * Start all background schedulers
 */
export async function startSchedulers(): Promise<void> {
  // Register all scheduled jobs
  scheduler.register({
    name: 'data-cleanup',
    interval: 6 * 60 * 60 * 1000, // Every 6 hours
    handler: dataCleanupJob,
  });

  scheduler.register({
    name: 'weather-update',
    interval: config.integrations.weather.updateInterval, // Every 5 minutes by default
    handler: weatherUpdateJob,
  });

  scheduler.register({
    name: 'premium-check',
    interval: 24 * 60 * 60 * 1000, // Every 24 hours
    handler: premiumCheckJob,
  });

  scheduler.register({
    name: 'system-maintenance',
    interval: 60 * 60 * 1000, // Every hour
    handler: maintenanceJob,
  });

  // Start the scheduler
  scheduler.start();

  logger.info('✅ Background schedulers started');
}

/**
 * Stop all schedulers
 */
export async function stopSchedulers(): Promise<void> {
  scheduler.stop();
  logger.info('🛑 Background schedulers stopped');
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
  return scheduler.getStatus();
}