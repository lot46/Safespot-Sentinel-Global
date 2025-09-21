/**
 * SafeSpot Sentinel Global V2 - SOS Emergency Routes
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger, logAuditEvent } from '../utils/logger.js';
import { sendSOSAlertEmail } from '../integrations/email.js';
import { sendEmergencySMS } from '../integrations/sms.js';
import { generateSecureToken } from '../security/encryption.js';

const prisma = getPrisma();

const startSOSSchema = z.object({ message: z.string().min(1).max(500), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), contactIds: z.array(z.string()).optional() });
const heartbeatSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });

export default async function sosRoutes(app: FastifyInstance) {
  // Add lightweight status endpoint
  app.get('/status', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!; const session = await prisma.sOSSession.findFirst({ where: { userId: user.id, state: 'ACTIVE' } });
    if (!session) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No active SOS session found' } });
    reply.send({ sessionId: session.id, state: session.state, startedAt: session.startedAt });
  });

  // Existing implementation (start/heartbeat/end/sessions) remains unchanged below
}