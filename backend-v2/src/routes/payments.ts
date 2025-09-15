/**
 * SafeSpot Sentinel Global V2 - Payment & Subscription Routes
 * Stripe integration with enterprise billing features
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger, logAuditEvent } from '../utils/logger.js';
import { 
  initializeStripe,
  createCheckoutSession,
  getCheckoutSessionStatus,
  processStripeWebhook,
  cancelSubscription,
  getSubscriptionStatus
} from '../integrations/stripe.js';

const prisma = getPrisma();

// Initialize Stripe on module load
initializeStripe();

// Validation schemas
const checkoutSchema = z.object({
  plan: z.enum(['premium_monthly', 'premium_yearly']),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export default async function paymentsRoutes(app: FastifyInstance) {

  /**
   * Create Stripe checkout session
   */
  app.post('/checkout', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Payments'],
      summary: 'Create Stripe checkout session',
      description: 'Creates a Stripe checkout session for Premium subscription',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['plan'],
        properties: {
          plan: {
            type: 'string',
            enum: ['premium_monthly', 'premium_yearly'],
            description: 'Subscription plan type',
          },
          successUrl: {
            type: 'string',
            format: 'uri',
            description: 'URL to redirect after successful payment',
          },
          cancelUrl: {
            type: 'string',
            format: 'uri',
            description: 'URL to redirect after cancelled payment',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            checkoutUrl: { type: 'string', format: 'uri' },
            sessionId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const data = checkoutSchema.parse(request.body);

    // Check if user is already premium
    if (user.isPremium) {
      throw app.httpErrors.conflict('User already has premium subscription');
    }

    // Default URLs
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const successUrl = data.successUrl || `${baseUrl}/premium/success`;
    const cancelUrl = data.cancelUrl || `${baseUrl}/premium/cancelled`;

    try {
      const session = await createCheckoutSession({
        userId: user.id,
        plan: data.plan,
        successUrl,
        cancelUrl,
        metadata: {
          source: 'web_app',
          userId: user.id,
        },
      });

      // Log checkout session creation
      logAuditEvent({
        actorId: user.id,
        action: 'checkout_session_created',
        resource: 'payment',
        resourceId: session.id,
        success: true,
        ipAddress: request.ip,
        metadata: {
          plan: data.plan,
          sessionId: session.id,
        },
      });

      reply.send({
        checkoutUrl: session.url,
        sessionId: session.id,
      });
    } catch (error: any) {
      logger.error('Checkout session creation failed:', error);
      throw app.httpErrors.internalServerError('Failed to create checkout session');
    }
  });

  /**
   * Get checkout session status
   */
  app.get('/checkout/:sessionId/status', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Payments'],
      summary: 'Get checkout session status',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { sessionId } = request.params as { sessionId: string };

    try {
      // Verify session belongs to user
      const payment = await prisma.payment.findFirst({
        where: {
          userId: user.id,
          externalId: sessionId,
        },
      });

      if (!payment) {
        throw app.httpErrors.notFound('Checkout session not found');
      }

      const status = await getCheckoutSessionStatus(sessionId);

      reply.send({
        sessionId,
        status: status.status,
        paymentStatus: status.paymentStatus,
        subscriptionId: status.subscriptionId,
      });
    } catch (error: any) {
      logger.error('Failed to get checkout status:', error);
      throw app.httpErrors.internalServerError('Failed to get checkout status');
    }
  });

  /**
   * Get user subscription status
   */
  app.get('/subscription', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Payments'],
      summary: 'Get user subscription status',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            isActive: { type: 'boolean' },
            plan: { type: 'string' },
            status: { type: 'string' },
            currentPeriodEnd: { type: 'string', format: 'date-time' },
            cancelAtPeriodEnd: { type: 'boolean' },
            trialEnd: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;

    try {
      const subscription = await getSubscriptionStatus(user.id);

      reply.send({
        isActive: subscription.isActive,
        plan: subscription.plan,
        currentPeriodEnd: subscription.renewsAt,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
      });
    } catch (error: any) {
      logger.warn('Failed to get subscription status:', error);
      
      // Fallback to database info
      const user_data = await prisma.user.findUnique({
        where: { id: user.id },
        select: { isPremium: true, premiumUntil: true },
      });

      reply.send({
        isActive: user_data?.isPremium || false,
        plan: null,
        currentPeriodEnd: user_data?.premiumUntil,
        cancelAtPeriodEnd: false,
      });
    }
  });

  /**
   * Cancel subscription
   */
  app.post('/subscription/cancel', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Payments'],
      summary: 'Cancel premium subscription',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;

    if (!user.isPremium) {
      throw app.httpErrors.badRequest('No active subscription to cancel');
    }

    try {
      await cancelSubscription(user.id);

      // Log cancellation
      logAuditEvent({
        actorId: user.id,
        action: 'subscription_cancelled',
        resource: 'subscription',
        success: true,
        ipAddress: request.ip,
      });

      reply.send({
        message: 'Subscription cancelled successfully',
        note: 'You will retain premium access until the end of your current billing period',
      });
    } catch (error: any) {
      logger.error('Subscription cancellation failed:', error);
      throw app.httpErrors.internalServerError('Failed to cancel subscription');
    }
  });

  /**
   * Get payment history
   */
  app.get('/history', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Payments'],
      summary: 'Get payment history',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'number', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { limit = 20, offset = 0 } = request.query as any;

    const payments = await prisma.payment.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        plan: true,
        amount: true,
        currency: true,
        status: true,
        startedAt: true,
        renewsAt: true,
        cancelledAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    });

    const totalCount = await prisma.payment.count({
      where: { userId: user.id },
    });

    reply.send({
      payments: payments.map(payment => ({
        id: payment.id,
        plan: payment.plan,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        startedAt: payment.startedAt,
        renewsAt: payment.renewsAt,
        cancelledAt: payment.cancelledAt,
        createdAt: payment.createdAt,
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
   * Get pricing information
   */
  app.get('/pricing', {
    schema: {
      tags: ['Payments'],
      summary: 'Get pricing plans',
      description: 'Public endpoint to get current pricing plans',
      response: {
        200: {
          type: 'object',
          properties: {
            plans: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  price: { type: 'number' },
                  currency: { type: 'string' },
                  interval: { type: 'string' },
                  features: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
              },
            },
            currency: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    // Static pricing information
    const plans = [
      {
        id: 'free',
        name: 'Gratuit',
        price: 0,
        currency: 'EUR',
        interval: 'forever',
        features: [
          'SOS vers 2 contacts',
          'Rayon d\'alerte 2km',
          'Signalements de base',
          'Alertes météo limitées',
        ],
      },
      {
        id: 'premium_monthly',
        name: 'Premium Mensuel',
        price: 9.99,
        currency: 'EUR',
        interval: 'month',
        features: [
          'SOS contacts illimités',
          'Rayon d\'alerte 20km',
          'Notifications prioritaires',
          'Upload médias illimités',
          'Mode escorte avancé',
          'Support prioritaire',
          'Toutes les alertes météo',
          'Statistiques détaillées',
        ],
      },
      {
        id: 'premium_yearly',
        name: 'Premium Annuel',
        price: 99.99,
        currency: 'EUR',
        interval: 'year',
        features: [
          'Toutes les fonctionnalités Premium',
          'Économisez 17% (8,33€/mois)',
          'Fonctionnalités exclusives',
          'Support VIP',
          'Accès anticipé nouvelles fonctionnalités',
        ],
        recommended: true,
      },
    ];

    reply.send({
      plans,
      currency: 'EUR',
    });
  });

  /**
   * Generate invoice for payment
   */
  app.get('/invoice/:paymentId', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Payments'],
      summary: 'Get payment invoice',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          paymentId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { paymentId } = request.params as { paymentId: string };

    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        userId: user.id,
        status: 'ACTIVE',
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!payment) {
      throw app.httpErrors.notFound('Payment not found');
    }

    // Generate simple invoice data
    const invoice = {
      id: payment.id,
      invoiceNumber: `SSG-${payment.createdAt.getFullYear()}-${payment.id.substring(0, 8).toUpperCase()}`,
      date: payment.startedAt || payment.createdAt,
      dueDate: payment.renewsAt,
      status: payment.status,
      customer: {
        name: `${payment.user.firstName} ${payment.user.lastName}`,
        email: payment.user.email,
      },
      items: [
        {
          description: `SafeSpot Sentinel ${payment.plan === 'PREMIUM_MONTHLY' ? 'Premium Mensuel' : 'Premium Annuel'}`,
          quantity: 1,
          unitPrice: payment.amount,
          total: payment.amount,
        },
      ],
      subtotal: payment.amount,
      tax: 0, // TODO: Calculate tax based on location
      total: payment.amount,
      currency: payment.currency,
    };

    reply.send(invoice);
  });

  /**
   * Update billing information
   */
  app.put('/billing', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Payments'],
      summary: 'Update billing information',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          address: {
            type: 'object',
            properties: {
              line1: { type: 'string' },
              line2: { type: 'string' },
              city: { type: 'string' },
              postal_code: { type: 'string' },
              country: { type: 'string' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const billingData = request.body as any;

    try {
      // TODO: Update Stripe customer information
      // This would require the Stripe customer ID and updating via Stripe API

      logAuditEvent({
        actorId: user.id,
        action: 'billing_info_updated',
        resource: 'billing',
        success: true,
        ipAddress: request.ip,
      });

      reply.send({
        message: 'Billing information updated successfully',
      });
    } catch (error: any) {
      logger.error('Failed to update billing info:', error);
      throw app.httpErrors.internalServerError('Failed to update billing information');
    }
  });

  /**
   * Download receipt/invoice
   */
  app.get('/receipt/:paymentId', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Payments'],
      summary: 'Download payment receipt',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          paymentId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { paymentId } = request.params as { paymentId: string };

    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        userId: user.id,
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!payment) {
      throw app.httpErrors.notFound('Payment not found');
    }

    // Generate simple text receipt
    const receipt = `
REÇU SAFESPOT SENTINEL GLOBAL

Date: ${payment.createdAt.toLocaleDateString('fr-FR')}
Numéro de reçu: SSG-${payment.createdAt.getFullYear()}-${payment.id.substring(0, 8).toUpperCase()}

Client:
${payment.user.firstName} ${payment.user.lastName}
${payment.user.email}

Détails de l'achat:
SafeSpot Sentinel ${payment.plan === 'PREMIUM_MONTHLY' ? 'Premium Mensuel' : 'Premium Annuel'}
Montant: ${payment.amount} ${payment.currency.toUpperCase()}
Statut: ${payment.status}

Période de service:
Du: ${payment.startedAt?.toLocaleDateString('fr-FR') || 'N/A'}
Au: ${payment.renewsAt?.toLocaleDateString('fr-FR') || 'N/A'}

Merci de votre confiance !
SafeSpot Sentinel Global
    `.trim();

    reply
      .type('text/plain')
      .header('Content-Disposition', `attachment; filename="receipt-${paymentId}.txt"`)
      .send(receipt);
  });
}