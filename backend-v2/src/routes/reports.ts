/**
 * SafeSpot Sentinel Global V2 - Reports Routes (with AI moderation)
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger } from '../utils/logger.js';
import { moderateContent } from '../services/moderation.js';

const prisma = getPrisma();

const createReportSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  type: z.enum(['CRIME','HARASSMENT','ROBBERY','TRANSPORT','FIRE','FLOOD','WEATHER','OTHER']).default('OTHER'),
  latitude: z.number(),
  longitude: z.number(),
  address: z.string().optional(),
  mediaUrls: z.array(z.string()).default([]),
});

export default async function reportsRoutes(app: FastifyInstance) {
  // Create report with AI moderation
  app.post('/create', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    const data = createReportSchema.parse(request.body);

    // 1) AI moderation
    const moderation = await moderateContent(
      { title: data.title, description: data.description, metadata: { userId: user.id } },
      { timeoutMs: 20000, maxRetries: 2, fallback: true }
    );

    // 2) Business rule based on your choices:
    //    - Persist moderation JSON
    //    - Auto-approve threshold trustScore >= 80
    //    - If inappropriate, create as FLAGGED (not 400)
    let status: 'PENDING' | 'VALIDATED' | 'FLAGGED' | 'REJECTED' = 'PENDING';
    if (!moderation.isAppropriate) {
      status = 'FLAGGED';
    } else if (moderation.trustScore >= 80) {
      status = 'VALIDATED';
    } else {
      status = 'PENDING';
    }

    // 3) Create in DB
    const report = await prisma.report.create({
      data: {
        userId: user.id,
        type: data.type,
        title: data.title,
        description: data.description,
        latitude: data.latitude,
        longitude: data.longitude,
        address: data.address,
        mediaUrls: data.mediaUrls,
        status,
        aiModeration: moderation,
      },
    });

    // 4) Return result
    reply.code(201).send({ report, moderation });
  });

  // List reports around a point (basic)
  app.get('/list', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { page = 1, pageSize = 20 } = (request.query as any) || {};
    const skip = (Number(page) - 1) * Number(pageSize);

    const [items, total] = await Promise.all([
      prisma.report.findMany({ orderBy: { createdAt: 'desc' }, skip, take: Number(pageSize) }),
      prisma.report.count(),
    ]);

    reply.send({ items, total, page: Number(page), pageSize: Number(pageSize) });
  });
}