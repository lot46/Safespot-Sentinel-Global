/**
 * SafeSpot Sentinel Global V2 - Community Reports Routes
 * AI-moderated incident reporting with geospatial features
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger, logAuditEvent } from '../utils/logger.js';

const prisma = getPrisma();

// Validation schemas
const createReportSchema = z.object({
  type: z.enum(['CRIME', 'HARASSMENT', 'ROBBERY', 'TRANSPORT', 'FIRE', 'FLOOD', 'WEATHER', 'OTHER']),
  title: z.string().min(1).max(255),
  description: z.string().min(10).max(2000),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().optional(),
  mediaUrls: z.array(z.string().url()).max(5).optional(),
});

const voteReportSchema = z.object({
  vote: z.enum(['CONFIRM', 'DISPUTE']),
  comment: z.string().max(500).optional(),
});

const getReportsSchema = z.object({
  bbox: z.string().optional(), // "lat1,lon1,lat2,lon2"
  type: z.enum(['CRIME', 'HARASSMENT', 'ROBBERY', 'TRANSPORT', 'FIRE', 'FLOOD', 'WEATHER', 'OTHER']).optional(),
  since: z.string().datetime().optional(),
  minTrust: z.number().min(0).max(100).optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

/**
 * AI-powered content moderation using OpenAI/Claude
 */
async function moderateReportContent(title: string, description: string): Promise<{
  isAppropriate: boolean;
  trustScore: number;
  reason: string;
  categories: string[];
}> {
  try {
    // This would integrate with your AI moderation service
    // For now, we'll simulate AI moderation logic
    
    const content = `${title} ${description}`.toLowerCase();
    
    // Simple content filtering rules (would be replaced with AI)
    const inappropriateKeywords = [
      'spam', 'fake', 'test', 'advertisement', 'promotion',
      'hate', 'discrimin', 'racist', 'sexist', 'offensive'
    ];
    
    const isInappropriate = inappropriateKeywords.some(keyword => 
      content.includes(keyword)
    );
    
    // Calculate trust score based on content quality
    let trustScore = 70; // Base score
    
    // Length and detail bonus
    if (description.length > 100) trustScore += 10;
    if (description.length > 300) trustScore += 5;
    
    // Specific location mention bonus
    if (content.includes('address') || content.includes('street') || content.includes('avenue')) {
      trustScore += 10;
    }
    
    // Time mention bonus
    if (content.includes('time') || content.includes('hour') || content.includes('minute')) {
      trustScore += 5;
    }
    
    // Penalties
    if (content.length < 50) trustScore -= 20;
    if (isInappropriate) trustScore = Math.min(trustScore, 30);
    
    // Clamp score
    trustScore = Math.max(0, Math.min(100, trustScore));
    
    // Categorize content
    const categories: string[] = [];
    if (content.includes('dangerous') || content.includes('unsafe')) categories.push('safety');
    if (content.includes('emergency') || content.includes('urgent')) categories.push('emergency');
    if (content.includes('weather') || content.includes('storm')) categories.push('weather');
    
    return {
      isAppropriate: !isInappropriate,
      trustScore,
      reason: isInappropriate ? 'Content flagged as inappropriate' : 'Content appears legitimate',
      categories,
    };
    
  } catch (error) {
    logger.error('AI moderation failed:', error);
    
    // Fallback to conservative moderation
    return {
      isAppropriate: true,
      trustScore: 50,
      reason: 'AI moderation unavailable, manual review required',
      categories: ['needs_review'],
    };
  }
}

export default async function reportsRoutes(app: FastifyInstance) {
  
  /**
   * Create new incident report
   */
  app.post('/', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Reports'],
      summary: 'Create new incident report',
      description: 'Submit a new community incident report with AI-powered moderation',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['type', 'title', 'description', 'latitude', 'longitude'],
        properties: {
          type: {
            type: 'string',
            enum: ['CRIME', 'HARASSMENT', 'ROBBERY', 'TRANSPORT', 'FIRE', 'FLOOD', 'WEATHER', 'OTHER'],
          },
          title: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string', minLength: 10, maxLength: 2000 },
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
          address: { type: 'string' },
          mediaUrls: {
            type: 'array',
            items: { type: 'string', format: 'uri' },
            maxItems: 5,
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            trustScore: { type: 'number' },
            moderationStatus: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const data = createReportSchema.parse(request.body);

    // Check rate limiting for reports (prevent spam)
    const recentReports = await prisma.report.count({
      where: {
        userId: user.id,
        createdAt: {
          gte: new Date(Date.now() - 3600000), // Last hour
        },
      },
    });

    const maxReportsPerHour = user.isPremium ? 20 : 5;
    if (recentReports >= maxReportsPerHour) {
      throw app.httpErrors.tooManyRequests('Too many reports submitted recently');
    }

    // AI content moderation
    const moderation = await moderateReportContent(data.title, data.description);

    // Determine initial status based on moderation
    let status: 'PENDING' | 'VALIDATED' | 'FLAGGED' = 'PENDING';
    if (moderation.isAppropriate && moderation.trustScore >= 70) {
      status = 'VALIDATED';
    } else if (!moderation.isAppropriate || moderation.trustScore < 30) {
      status = 'FLAGGED';
    }

    // Create report
    const report = await prisma.report.create({
      data: {
        userId: user.id,
        type: data.type,
        title: data.title,
        description: data.description,
        latitude: data.latitude,
        longitude: data.longitude,
        geom: `POINT(${data.longitude} ${data.latitude})`,
        address: data.address,
        mediaUrls: data.mediaUrls || [],
        status,
        trustScore: moderation.trustScore,
        aiModeration: {
          isAppropriate: moderation.isAppropriate,
          trustScore: moderation.trustScore,
          reason: moderation.reason,
          categories: moderation.categories,
          timestamp: new Date().toISOString(),
          version: '1.0',
        },
      },
    });

    // Log report creation
    logAuditEvent({
      actorId: user.id,
      action: 'report_created',
      resource: 'report',
      resourceId: report.id,
      success: true,
      ipAddress: request.ip,
      metadata: {
        type: data.type,
        status,
        trustScore: moderation.trustScore,
        location: { latitude: data.latitude, longitude: data.longitude },
      },
    });

    logger.info('Report created', {
      userId: user.id,
      reportId: report.id,
      type: data.type,
      status,
      trustScore: moderation.trustScore,
    });

    reply.code(201).send({
      id: report.id,
      status: report.status,
      trustScore: report.trustScore,
      moderationStatus: moderation.isAppropriate ? 'approved' : 'flagged',
      createdAt: report.createdAt,
    });
  });

  /**
   * Get reports with geospatial filtering
   */
  app.get('/', {
    schema: {
      tags: ['Reports'],
      summary: 'Get community reports',
      description: 'Retrieve incident reports with optional geospatial and type filtering',
      querystring: {
        type: 'object',
        properties: {
          bbox: {
            type: 'string',
            description: 'Bounding box as "lat1,lon1,lat2,lon2"',
            pattern: '^-?\\d+\\.\\d+,-?\\d+\\.\\d+,-?\\d+\\.\\d+,-?\\d+\\.\\d+$',
          },
          type: {
            type: 'string',
            enum: ['CRIME', 'HARASSMENT', 'ROBBERY', 'TRANSPORT', 'FIRE', 'FLOOD', 'WEATHER', 'OTHER'],
          },
          since: { type: 'string', format: 'date-time' },
          minTrust: { type: 'number', minimum: 0, maximum: 100 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
          offset: { type: 'number', minimum: 0, default: 0 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            reports: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                  address: { type: 'string' },
                  trustScore: { type: 'number' },
                  voteCount: { type: 'number' },
                  status: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
            pagination: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                limit: { type: 'number' },
                offset: { type: 'number' },
                hasMore: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const query = getReportsSchema.parse(request.query);

    // Build database query
    const whereClause: any = {
      status: 'VALIDATED', // Only show validated reports
      deletedAt: null,
    };

    // Type filter
    if (query.type) {
      whereClause.type = query.type;
    }

    // Trust score filter
    if (query.minTrust !== undefined) {
      whereClause.trustScore = { gte: query.minTrust };
    }

    // Time filter
    if (query.since) {
      whereClause.createdAt = { gte: new Date(query.since) };
    }

    // Geographic bounding box filter (requires raw SQL for PostGIS)
    let geoFilter = '';
    if (query.bbox) {
      const [lat1, lon1, lat2, lon2] = query.bbox.split(',').map(Number);
      geoFilter = `AND ST_Within(geom, ST_MakeEnvelope(${lon1}, ${lat1}, ${lon2}, ${lat2}, 4326))`;
    }

    // Get reports
    const reports = await prisma.report.findMany({
      where: whereClause,
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        latitude: true,
        longitude: true,
        address: true,
        trustScore: true,
        voteCount: true,
        status: true,
        createdAt: true,
        mediaUrls: true,
      },
      orderBy: [
        { trustScore: 'desc' },
        { createdAt: 'desc' },
      ],
      skip: query.offset,
      take: query.limit,
    });

    // Get total count for pagination
    const totalCount = await prisma.report.count({ where: whereClause });

    reply.send({
      reports,
      pagination: {
        total: totalCount,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + query.limit < totalCount,
      },
    });
  });

  /**
   * Get specific report details
   */
  app.get('/:reportId', {
    schema: {
      tags: ['Reports'],
      summary: 'Get report details',
      params: {
        type: 'object',
        properties: {
          reportId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { reportId } = request.params as { reportId: string };

    const report = await prisma.report.findUnique({
      where: { 
        id: reportId,
        deletedAt: null,
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        votes: {
          select: {
            vote: true,
            comment: true,
            createdAt: true,
            voter: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!report) {
      throw app.httpErrors.notFound('Report not found');
    }

    // Increment view count
    await prisma.report.update({
      where: { id: reportId },
      data: { viewCount: { increment: 1 } },
    });

    reply.send({
      id: report.id,
      type: report.type,
      title: report.title,
      description: report.description,
      latitude: report.latitude,
      longitude: report.longitude,
      address: report.address,
      mediaUrls: report.mediaUrls,
      trustScore: report.trustScore,
      voteCount: report.voteCount,
      viewCount: report.viewCount + 1,
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      author: {
        name: `${report.user.firstName} ${report.user.lastName}`,
        role: report.user.role,
      },
      votes: report.votes.map(vote => ({
        vote: vote.vote,
        comment: vote.comment,
        createdAt: vote.createdAt,
        voter: `${vote.voter.firstName} ${vote.voter.lastName}`,
      })),
    });
  });

  /**
   * Vote on report (confirm or dispute)
   */
  app.post('/:reportId/vote', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Reports'],
      summary: 'Vote on report validity',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          reportId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['vote'],
        properties: {
          vote: { type: 'string', enum: ['CONFIRM', 'DISPUTE'] },
          comment: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { reportId } = request.params as { reportId: string };
    const data = voteReportSchema.parse(request.body);

    // Check if report exists and is not deleted
    const report = await prisma.report.findUnique({
      where: { 
        id: reportId,
        deletedAt: null,
      },
    });

    if (!report) {
      throw app.httpErrors.notFound('Report not found');
    }

    // Check if user has already voted
    const existingVote = await prisma.reportVote.findUnique({
      where: {
        reportId_voterId: {
          reportId,
          voterId: user.id,
        },
      },
    });

    if (existingVote) {
      throw app.httpErrors.conflict('You have already voted on this report');
    }

    // Can't vote on own report
    if (report.userId === user.id) {
      throw app.httpErrors.badRequest('Cannot vote on your own report');
    }

    // Create vote
    await prisma.reportVote.create({
      data: {
        reportId,
        voterId: user.id,
        vote: data.vote,
        comment: data.comment,
      },
    });

    // Update report vote count and recalculate trust score
    const voteStats = await prisma.reportVote.groupBy({
      by: ['vote'],
      where: { reportId },
      _count: { vote: true },
    });

    const confirmVotes = voteStats.find(s => s.vote === 'CONFIRM')?._count.vote || 0;
    const disputeVotes = voteStats.find(s => s.vote === 'DISPUTE')?._count.vote || 0;
    const totalVotes = confirmVotes + disputeVotes;

    // Recalculate trust score based on votes
    let newTrustScore = report.trustScore;
    if (totalVotes > 0) {
      const voteRatio = confirmVotes / totalVotes;
      const voteInfluence = Math.min(totalVotes * 5, 30); // Max 30 point influence from votes
      newTrustScore = Math.round(
        (report.trustScore * 0.7) + (voteRatio * 100 * 0.3) + 
        (data.vote === 'CONFIRM' ? voteInfluence / totalVotes : -voteInfluence / totalVotes)
      );
      newTrustScore = Math.max(0, Math.min(100, newTrustScore));
    }

    // Update report
    await prisma.report.update({
      where: { id: reportId },
      data: {
        voteCount: totalVotes,
        trustScore: newTrustScore,
      },
    });

    // Log vote
    logAuditEvent({
      actorId: user.id,
      action: 'report_voted',
      resource: 'report',
      resourceId: reportId,
      success: true,
      ipAddress: request.ip,
      metadata: {
        vote: data.vote,
        newTrustScore,
        totalVotes,
      },
    });

    reply.send({
      message: 'Vote recorded successfully',
      newTrustScore,
      totalVotes,
    });
  });

  /**
   * Get user's own reports
   */
  app.get('/my/reports', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Reports'],
      summary: 'Get user own reports',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'VALIDATED', 'REJECTED', 'FLAGGED'] },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'number', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { status, limit = 20, offset = 0 } = request.query as any;

    const whereClause: any = {
      userId: user.id,
      deletedAt: null,
    };

    if (status) {
      whereClause.status = status;
    }

    const reports = await prisma.report.findMany({
      where: whereClause,
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        latitude: true,
        longitude: true,
        trustScore: true,
        voteCount: true,
        viewCount: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    });

    const totalCount = await prisma.report.count({ where: whereClause });

    reply.send({
      reports,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });
  });

  /**
   * Delete user's own report
   */
  app.delete('/:reportId', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Reports'],
      summary: 'Delete own report',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          reportId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { reportId } = request.params as { reportId: string };

    // Find report and verify ownership
    const report = await prisma.report.findUnique({
      where: { 
        id: reportId,
        userId: user.id,
        deletedAt: null,
      },
    });

    if (!report) {
      throw app.httpErrors.notFound('Report not found or not owned by user');
    }

    // Soft delete the report
    await prisma.report.update({
      where: { id: reportId },
      data: { deletedAt: new Date() },
    });

    // Log deletion
    logAuditEvent({
      actorId: user.id,
      action: 'report_deleted',
      resource: 'report',
      resourceId: reportId,
      success: true,
      ipAddress: request.ip,
    });

    reply.send({ message: 'Report deleted successfully' });
  });
}