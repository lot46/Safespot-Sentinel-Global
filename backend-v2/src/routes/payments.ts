/**
 * SafeSpot Sentinel Global V2 - Payments (Phase 4 scaffolds + Stripe enable behind flags)
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger } from '../utils/logger.js';
import { createCheckoutSession } from '../integrations/stripe.js';

const prisma = getPrisma();

const intentSchema = z.object({
  plan: z.enum(['PREMIUM_MONTHLY', 'PREMIUM_YEARLY']),
  currency: z.string().default('EUR'),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  idempotencyKey: z.string().min(8).max(64).optional(),
});

export default async function paymentsRoutes(app: FastifyInstance) {
  // Create payment intent (Stripe when enabled)
  app.post('/intent', { preHandler: [app.authenticate], schema: { tags: ['Payments'], summary: 'Create payment intent (feature-flagged)' } }, async (request, reply) => {
    const user = request.user!;
    const body = intentSchema.parse(request.body);

    const provider = (process.env.GATEWAY_PROVIDER || '').toLowerCase();
    if (provider !== 'stripe') {
      return reply.code(501).send({ error: { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED', message: 'Set GATEWAY_PROVIDER=stripe and Stripe keys' } });
    }

    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID || !process.env.STRIPE_PREMIUM_YEARLY_PRICE_ID) {
      return reply.code(501).send({ error: { code: 'STRIPE_KEYS_MISSING', message: 'Stripe keys or price IDs missing' } });
    }

    try {
      const session = await createCheckoutSession({
        userId: user.id,
        plan: body.plan === 'PREMIUM_MONTHLY' ? 'premium_monthly' : 'premium_yearly',
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
        idempotencyKey: body.idempotencyKey,
        metadata: { currency: body.currency },
      });

      reply.send({ sessionId: session.id, url: session.url, paymentStatus: session.paymentStatus, subscriptionId: session.subscriptionId });

    } catch (error: any) {
      logger.error({ error: error?.message }, 'Create payment intent failed');
      reply.code(400).send({ error: { code: 'INTENT_FAILED', message: error?.message || 'Failed to create intent' } });
    }
  });

  // Get payment by id (RBAC: owner or admin)
  app.get('/:id', { preHandler: [app.authenticate], schema: { tags: ['Payments'], summary: 'Get payment by ID' } }, async (request, reply) => {
    const { id } = request.params as any; const user = request.user!;
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
    if (payment.userId !== user.id && user.role !== 'ADMIN') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    reply.send(payment);
  });
}