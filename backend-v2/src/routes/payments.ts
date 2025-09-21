/**
 * SafeSpot Sentinel Global V2 - Payments (Phase 4 scaffolds)
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';

const prisma = getPrisma();

const intentSchema = z.object({
  plan: z.enum(['PREMIUM_MONTHLY', 'PREMIUM_YEARLY']),
  currency: z.string().default('EUR'),
});

export default async function paymentsRoutes(app: FastifyInstance) {
  // Create payment intent (stub)
  app.post('/intent', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = intentSchema.parse(request.body);
    const provider = process.env.GATEWAY_PROVIDER || '';
    if (!provider) return reply.code(501).send({ error: { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED', message: 'Set GATEWAY_PROVIDER and keys' } });
    // TODO: Implement Stripe/Adyen based on provider
    reply.code(501).send({ error: { code: 'NOT_IMPLEMENTED', message: 'Gateway not implemented in scaffold' } });
  });

  // Get payment by id (RBAC: owner or admin)
  app.get('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as any; const user = request.user!;
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
    if (payment.userId !== user.id && user.role !== 'ADMIN') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    reply.send(payment);
  });
}