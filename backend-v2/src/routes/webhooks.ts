/**
 * SafeSpot Sentinel Global V2 - Webhook Routes
 * External service webhooks (Stripe, etc.) with signature verification
 */

import { FastifyInstance } from 'fastify';
import { logger, logAuditEvent } from '../utils/logger.js';
import { processStripeWebhook } from '../integrations/stripe.js';

export default async function webhookRoutes(app: FastifyInstance) {
  
  /**
   * Stripe webhook handler
   */
  app.post('/stripe', {
    config: {
      // Raw body needed for signature verification
      rawBody: true,
    },
    schema: {
      tags: ['Webhooks'],
      summary: 'Stripe webhook endpoint',
      description: 'Handles Stripe webhook events for payment processing',
      hide: true, // Hide from public API docs
    },
  }, async (request, reply) => {
    const signature = request.headers['stripe-signature'] as string;
    const body = request.rawBody as string;

    if (!signature) {
      logger.warn('Stripe webhook missing signature', {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw app.httpErrors.badRequest('Missing Stripe signature');
    }

    if (!body) {
      logger.warn('Stripe webhook missing body', {
        ip: request.ip,
        signature: signature.substring(0, 20) + '...',
      });
      throw app.httpErrors.badRequest('Missing request body');
    }

    try {
      const result = await processStripeWebhook(body, signature);

      logger.info('Stripe webhook processed successfully', {
        eventType: result.eventType,
        processed: result.processed,
        ip: request.ip,
      });

      // Log webhook processing
      logAuditEvent({
        action: 'webhook_processed',
        resource: 'stripe_webhook',
        success: true,
        ipAddress: request.ip,
        metadata: {
          eventType: result.eventType,
          processed: result.processed,
        },
      });

      reply.send({ received: true, processed: result.processed });

    } catch (error: any) {
      logger.error('Stripe webhook processing failed:', {
        error: error.message,
        signature: signature.substring(0, 20) + '...',
        ip: request.ip,
      });

      // Log failed webhook
      logAuditEvent({
        action: 'webhook_failed',
        resource: 'stripe_webhook',
        success: false,
        ipAddress: request.ip,
        metadata: {
          error: error.message,
        },
      });

      throw app.httpErrors.badRequest('Webhook processing failed');
    }
  });

  /**
   * Generic webhook test endpoint (development only)
   */
  if (process.env.NODE_ENV === 'development') {
    app.post('/test', {
      schema: {
        tags: ['Webhooks'],
        summary: 'Test webhook endpoint (dev only)',
        description: 'Development endpoint for testing webhook functionality',
        body: {
          type: 'object',
          properties: {
            event: { type: 'string' },
            data: { type: 'object' },
          },
        },
      },
    }, async (request, reply) => {
      const { event, data } = request.body as { event: string; data: any };

      logger.info('Test webhook received', {
        event,
        data,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });

      // Simulate webhook processing
      await new Promise(resolve => setTimeout(resolve, 100));

      reply.send({
        message: 'Test webhook processed',
        event,
        timestamp: new Date().toISOString(),
        processed: true,
      });
    });
  }

  /**
   * Health check for webhook endpoint
   */
  app.get('/health', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Webhook health check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            webhooks: {
              type: 'object',
              properties: {
                stripe: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    reply.send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      webhooks: {
        stripe: !!process.env.STRIPE_WEBHOOK_SECRET,
      },
    });
  });
}