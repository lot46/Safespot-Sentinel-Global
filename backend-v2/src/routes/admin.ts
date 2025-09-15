/**
 * SafeSpot Sentinel Global V2 - Admin Routes
 * Administrative functions with role-based access control
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger, logAuditEvent } from '../utils/logger.js';
import { getDatabaseStats } from '../database/index.js';
import { getRedisStats } from '../cache/redis.js';
import { getWebSocketStats } from '../websocket/index.js';

const prisma = getPrisma();

// Validation schemas
const moderateReportSchema = z.object({
  action: z.enum(['approve', 'reject', 'flag']),
  reason: z.string().max(500).optional(),
  trustScore: z.number().min(0).max(100).optional(),
});

const updateUserSchema = z.object({
  role: z.enum(['USER', 'MODERATOR', 'ADMIN']).optional(),
  isActive: z.boolean().optional(),
  isBanned: z.boolean().optional(),
  bannedReason: z.string().max(500).optional(),
});

export default async function adminRoutes(app: FastifyInstance) {

  // Middleware to require admin role
  app.addHook('preHandler', async (request, reply) => {
    if (!request.user) {
      throw app.httpErrors.unauthorized('Authentication required');
    }

    if (request.user.role !== 'ADMIN' && request.user.role !== 'MODERATOR') {
      throw app.httpErrors.forbidden('Admin or moderator access required');
    }
  });

  /**
   * Get admin dashboard statistics
   */
  app.get('/dashboard', {
    preHandler: [app.authenticate], // Admin middleware already applied above
    schema: {
      tags: ['Admin'],
      summary: 'Get admin dashboard statistics',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            database: { type: 'object' },
            redis: { type: 'object' },
            websockets: { type: 'object' },
            system: { type: 'object' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;

    try {
      // Get system statistics
      const [dbStats, redisStats, wsStats] = await Promise.all([
        getDatabaseStats(),
        getRedisStats(),
        Promise.resolve(getWebSocketStats()),
      ]);

      // Additional admin-specific stats
      const [
        pendingReports,
        flaggedReports,
        recentUsers,
        activeSOSSessions,
        securityEvents,
      ] = await Promise.all([
        prisma.report.count({
          where: { status: 'PENDING' },
        }),
        prisma.report.count({
          where: { status: 'FLAGGED' },
        }),
        prisma.user.count({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
            },
          },
        }),
        prisma.sOSSession.count({
          where: { state: 'ACTIVE' },
        }),
        prisma.securityEvent.count({
          where: {
            resolved: false,
            severity: { in: ['high', 'critical'] },
          },
        }),
      ]);

      const systemInfo = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform,
        timestamp: new Date().toISOString(),
      };

      reply.send({
        database: {
          ...dbStats,
          pendingReports,
          flaggedReports,
          activeSOSSessions,
        },
        redis: redisStats,
        websockets: wsStats,
        system: {
          ...systemInfo,
          recentUsers,
          securityEvents,
        },
      });

    } catch (error) {
      logger.error('Admin dashboard stats failed:', error);
      throw app.httpErrors.internalServerError('Failed to fetch dashboard statistics');
    }
  });

  /**
   * Get pending reports for moderation
   */
  app.get('/reports/pending', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Admin'],
      summary: 'Get reports pending moderation',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'number', minimum: 0, default: 0 },
          type: { type: 'string' },
          minTrust: { type: 'number', minimum: 0, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const { limit = 20, offset = 0, type, minTrust } = request.query as any;

    const whereClause: any = {
      status: { in: ['PENDING', 'FLAGGED'] },
      deletedAt: null,
    };

    if (type) {
      whereClause.type = type;
    }

    if (minTrust !== undefined) {
      whereClause.trustScore = { gte: minTrust };
    }

    const reports = await prisma.report.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
        votes: {
          select: {
            vote: true,
            voter: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: [
        { status: 'desc' }, // FLAGGED first
        { trustScore: 'asc' }, // Low trust scores first
        { createdAt: 'asc' }, // Oldest first
      ],
      skip: offset,
      take: limit,
    });

    const totalCount = await prisma.report.count({ where: whereClause });

    reply.send({
      reports: reports.map(report => ({
        id: report.id,
        type: report.type,
        title: report.title,
        description: report.description,
        latitude: report.latitude,
        longitude: report.longitude,
        address: report.address,
        mediaUrls: report.mediaUrls,
        status: report.status,
        trustScore: report.trustScore,
        voteCount: report.voteCount,
        viewCount: report.viewCount,
        aiModeration: report.aiModeration,
        createdAt: report.createdAt,
        user: {
          id: report.user.id,
          name: `${report.user.firstName} ${report.user.lastName}`,
          email: report.user.email,
          role: report.user.role,
        },
        votes: report.votes.map(vote => ({
          vote: vote.vote,
          voter: `${vote.voter.firstName} ${vote.voter.lastName}`,
        })),
      })),
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });
  });

  /**
   * Moderate a report
   */
  app.post('/reports/:reportId/moderate', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Admin'],
      summary: 'Moderate a report',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          reportId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['approve', 'reject', 'flag'] },
          reason: { type: 'string', maxLength: 500 },
          trustScore: { type: 'number', minimum: 0, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { reportId } = request.params as { reportId: string };
    const data = moderateReportSchema.parse(request.body);

    // Find report
    const report = await prisma.report.findUnique({
      where: { id: reportId, deletedAt: null },
    });

    if (!report) {
      throw app.httpErrors.notFound('Report not found');
    }

    // Map action to status
    const statusMap = {
      approve: 'VALIDATED',
      reject: 'REJECTED',
      flag: 'FLAGGED',
    };

    const newStatus = statusMap[data.action];
    const newTrustScore = data.trustScore ?? (data.action === 'approve' ? Math.max(report.trustScore, 70) : Math.min(report.trustScore, 30));

    // Update report
    await prisma.report.update({
      where: { id: reportId },
      data: {
        status: newStatus,
        trustScore: newTrustScore,
        moderatedBy: user.id,
        moderatedAt: new Date(),
      },
    });

    // Log moderation action
    logAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: `report_${data.action}`,
      resource: 'report',
      resourceId: reportId,
      success: true,
      ipAddress: request.ip,
      metadata: {
        previousStatus: report.status,
        newStatus,
        previousTrustScore: report.trustScore,
        newTrustScore,
        reason: data.reason,
      },
    });

    reply.send({
      message: `Report ${data.action}d successfully`,
      reportId,
      newStatus,
      newTrustScore,
      moderatedBy: user.id,
      moderatedAt: new Date(),
    });
  });

  /**
   * Get users for administration
   */
  app.get('/users', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Admin'],
      summary: 'Get users for administration',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'number', minimum: 0, default: 0 },
          role: { type: 'string', enum: ['USER', 'MODERATOR', 'ADMIN'] },
          isActive: { type: 'boolean' },
          isBanned: { type: 'boolean' },
          search: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    // Only ADMIN can see all users
    if (request.user?.role !== 'ADMIN') {
      throw app.httpErrors.forbidden('Admin access required');
    }

    const { limit = 20, offset = 0, role, isActive, isBanned, search } = request.query as any;

    const whereClause: any = {
      deletedAt: null,
    };

    if (role) whereClause.role = role;
    if (isActive !== undefined) whereClause.isActive = isActive;
    if (isBanned !== undefined) whereClause.isBanned = isBanned;

    if (search) {
      whereClause.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isBanned: true,
        bannedReason: true,
        isPremium: true,
        emailVerified: true,
        phoneVerified: true,
        twoFAEnabled: true,
        lastLoginAt: true,
        loginCount: true,
        createdAt: true,
        _count: {
          select: {
            reports: true,
            sosSessions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    });

    const totalCount = await prisma.user.count({ where: whereClause });

    reply.send({
      users: users.map(user => ({
        id: user.id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        role: user.role,
        isActive: user.isActive,
        isBanned: user.isBanned,
        bannedReason: user.bannedReason,
        isPremium: user.isPremium,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        twoFAEnabled: user.twoFAEnabled,
        lastLoginAt: user.lastLoginAt,
        loginCount: user.loginCount,
        createdAt: user.createdAt,
        stats: {
          reports: user._count.reports,
          sosSessions: user._count.sosSessions,
        },
      })),
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });
  });

  /**
   * Update user (ban, role change, etc.)
   */
  app.patch('/users/:userId', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Admin'],
      summary: 'Update user account',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['USER', 'MODERATOR', 'ADMIN'] },
          isActive: { type: 'boolean' },
          isBanned: { type: 'boolean' },
          bannedReason: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    // Only ADMIN can modify users
    if (request.user?.role !== 'ADMIN') {
      throw app.httpErrors.forbidden('Admin access required');
    }

    const currentUser = request.user!;
    const { userId } = request.params as { userId: string };
    const data = updateUserSchema.parse(request.body);

    // Find target user
    const targetUser = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });

    if (!targetUser) {
      throw app.httpErrors.notFound('User not found');
    }

    // Prevent self-modification of critical fields
    if (currentUser.id === userId) {
      if (data.role || data.isActive === false || data.isBanned === true) {
        throw app.httpErrors.badRequest('Cannot modify your own admin privileges');
      }
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...data,
        ...(data.isBanned && { bannedAt: new Date() }),
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isBanned: true,
        bannedReason: true,
        bannedAt: true,
      },
    });

    // Log admin action
    logAuditEvent({
      actorId: currentUser.id,
      actorRole: currentUser.role,
      action: 'user_updated',
      resource: 'user',
      resourceId: userId,
      success: true,
      ipAddress: request.ip,
      metadata: {
        changes: data,
        targetUser: {
          email: targetUser.email,
          role: targetUser.role,
        },
      },
    });

    reply.send({
      message: 'User updated successfully',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: `${updatedUser.firstName} ${updatedUser.lastName}`,
        role: updatedUser.role,
        isActive: updatedUser.isActive,
        isBanned: updatedUser.isBanned,
        bannedReason: updatedUser.bannedReason,
      },
    });
  });

  /**
   * Get audit logs
   */
  app.get('/audit', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Admin'],
      summary: 'Get audit logs',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
          offset: { type: 'number', minimum: 0, default: 0 },
          action: { type: 'string' },
          resource: { type: 'string' },
          actorId: { type: 'string' },
          since: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (request, reply) => {
    const { limit = 50, offset = 0, action, resource, actorId, since } = request.query as any;

    const whereClause: any = {};

    if (action) whereClause.action = action;
    if (resource) whereClause.resource = resource;
    if (actorId) whereClause.actorId = actorId;
    if (since) whereClause.createdAt = { gte: new Date(since) };

    const auditLogs = await prisma.auditLog.findMany({
      where: whereClause,
      include: {
        actor: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    });

    const totalCount = await prisma.auditLog.count({ where: whereClause });

    reply.send({
      auditLogs: auditLogs.map(log => ({
        id: log.id,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        success: log.success,
        errorCode: log.errorCode,
        errorMessage: log.errorMessage,
        ipHash: log.ipHash,
        metadata: log.metadata,
        createdAt: log.createdAt,
        actor: log.actor ? {
          name: `${log.actor.firstName} ${log.actor.lastName}`,
          email: log.actor.email,
          role: log.actor.role,
        } : null,
      })),
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });
  });

  /**
   * Get security events
   */
  app.get('/security/events', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Admin'],
      summary: 'Get security events',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'number', minimum: 0, default: 0 },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          resolved: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { limit = 20, offset = 0, severity, resolved } = request.query as any;

    const whereClause: any = {};

    if (severity) whereClause.severity = severity;
    if (resolved !== undefined) whereClause.resolved = resolved;

    const events = await prisma.securityEvent.findMany({
      where: whereClause,
      orderBy: [
        { severity: 'desc' },
        { createdAt: 'desc' },
      ],
      skip: offset,
      take: limit,
    });

    const totalCount = await prisma.securityEvent.count({ where: whereClause });

    reply.send({
      events,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });
  });

  /**
   * System health check
   */
  app.get('/health/detailed', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Admin'],
      summary: 'Detailed system health check',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { checkDatabaseHealth } = await import('../database/index.js');
    const { checkRedisHealth } = await import('../cache/redis.js');

    const [dbHealth, redisHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);

    const health = {
      overall: dbHealth && redisHealth ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: {
          status: dbHealth ? 'healthy' : 'unhealthy',
          // Add more database metrics
        },
        redis: {
          status: redisHealth ? 'healthy' : 'unhealthy',
          // Add more Redis metrics
        },
        websockets: {
          status: 'healthy', // WebSocket service check would go here
          connections: getWebSocketStats().totalClients,
        },
      },
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform,
      },
    };

    reply.code(dbHealth && redisHealth ? 200 : 503).send(health);
  });
}