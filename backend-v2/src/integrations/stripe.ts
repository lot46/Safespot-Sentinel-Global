/**
 * SafeSpot Sentinel Global V2 - Stripe Payment Integration
 * Secure subscription management with webhooks and compliance
 */

import Stripe from 'stripe';
import { config } from '../config/index.js';
import { logger, logAuditEvent } from '../utils/logger.js';
import { getPrisma } from '../database/index.js';
import { setCache, getCache } from '../cache/redis.js';

const prisma = getPrisma();

let stripe: Stripe | null = null;

export interface CreateCheckoutSessionParams {
  userId: string;
  plan: 'premium_monthly' | 'premium_yearly';
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSession {
  id: string;
  url: string;
  paymentStatus: string;
  subscriptionId?: string;
}

/**
 * Initialize Stripe client
 */
export function initializeStripe(): void {
  if (!config.payments.stripe.secretKey) {
    logger.warn('Stripe not configured - payment features disabled');
    return;
  }

  stripe = new Stripe(config.payments.stripe.secretKey, {
    apiVersion: '2023-10-16',
    typescript: true,
    telemetry: false, // Disable for privacy
  });

  logger.info('✅ Stripe initialized');
}

/**
 * Get Stripe client (with initialization check)
 */
function getStripe(): Stripe {
  if (!stripe) {
    initializeStripe();
    if (!stripe) {
      throw new Error('Stripe not configured');
    }
  }
  return stripe;
}

/**
 * Create or get Stripe customer
 */
export async function createOrGetCustomer(userId: string, email: string, name: string): Promise<string> {
  try {
    const stripeClient = getStripe();
    
    // Check if user already has a customer ID
    const existingPayment = await prisma.payment.findFirst({
      where: { userId, customerId: { not: null } },
      select: { customerId: true },
    });

    if (existingPayment?.customerId) {
      // Verify customer still exists in Stripe
      try {
        await stripeClient.customers.retrieve(existingPayment.customerId);
        return existingPayment.customerId;
      } catch (error) {
        logger.warn('Stripe customer not found, creating new one', { customerId: existingPayment.customerId });
      }
    }

    // Create new customer
    const customer = await stripeClient.customers.create({
      email,
      name,
      metadata: {
        userId,
        platform: 'SafeSpot Sentinel Global',
      },
    });

    logger.info('Stripe customer created', { userId, customerId: customer.id });
    return customer.id;

  } catch (error) {
    logger.error('Failed to create Stripe customer:', error);
    throw new Error('Customer creation failed');
  }
}

/**
 * Create checkout session for subscription
 */
export async function createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSession> {
  try {
    const stripeClient = getStripe();
    
    // Get user details
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { email: true, firstName: true, lastName: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Get or create customer
    const customerId = await createOrGetCustomer(
      params.userId,
      user.email,
      `${user.firstName} ${user.lastName}`
    );

    // Get price ID based on plan
    const priceId = params.plan === 'premium_monthly' 
      ? config.payments.stripe.premiumMonthlyPriceId
      : config.payments.stripe.premiumYearlyPriceId;

    if (!priceId) {
      throw new Error(`Price ID not configured for plan: ${params.plan}`);
    }

    // Create checkout session
    const session = await stripeClient.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${params.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: params.cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: {
        enabled: true,
      },
      metadata: {
        userId: params.userId,
        plan: params.plan,
        ...params.metadata,
      },
      subscription_data: {
        metadata: {
          userId: params.userId,
          plan: params.plan,
        },
      },
    });

    // Store payment record
    await prisma.payment.create({
      data: {
        userId: params.userId,
        plan: params.plan.toUpperCase() as any,
        provider: 'STRIPE',
        externalId: session.id,
        customerId,
        amount: params.plan === 'premium_monthly' ? 9.99 : 99.99,
        currency: 'EUR',
        status: 'PENDING',
        metadata: params.metadata || {},
      },
    });

    logger.info('Checkout session created', { userId: params.userId, sessionId: session.id });

    return {
      id: session.id,
      url: session.url!,
      paymentStatus: session.payment_status,
      subscriptionId: session.subscription as string | undefined,
    };

  } catch (error) {
    logger.error('Failed to create checkout session:', error);
    throw new Error('Checkout session creation failed');
  }
}

/**
 * Get checkout session status
 */
export async function getCheckoutSessionStatus(sessionId: string): Promise<{
  status: string;
  paymentStatus: string;
  subscriptionId?: string;
  customerId?: string;
}> {
  try {
    const stripeClient = getStripe();
    
    const session = await stripeClient.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    return {
      status: session.status || 'unknown',
      paymentStatus: session.payment_status,
      subscriptionId: session.subscription as string | undefined,
      customerId: session.customer as string | undefined,
    };

  } catch (error) {
    logger.error('Failed to get checkout session status:', error);
    throw new Error('Failed to retrieve session status');
  }
}

/**
 * Handle successful payment (called from webhook)
 */
export async function handleSuccessfulPayment(sessionId: string, subscriptionId: string): Promise<void> {
  try {
    const stripeClient = getStripe();
    
    // Get session details
    const session = await stripeClient.checkout.sessions.retrieve(sessionId);
    const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
    
    const userId = session.metadata?.userId;
    if (!userId) {
      throw new Error('User ID not found in session metadata');
    }

    // Update payment record
    const payment = await prisma.payment.findFirst({
      where: { externalId: sessionId },
    });

    if (!payment) {
      throw new Error('Payment record not found');
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'ACTIVE',
        externalId: subscriptionId, // Update with subscription ID
        startedAt: new Date(subscription.created * 1000),
        renewsAt: new Date(subscription.current_period_end * 1000),
      },
    });

    // Update user premium status
    await prisma.user.update({
      where: { id: userId },
      data: {
        isPremium: true,
        premiumUntil: new Date(subscription.current_period_end * 1000),
      },
    });

    // Log audit event
    logAuditEvent({
      actorId: userId,
      action: 'upgrade_to_premium',
      resource: 'subscription',
      resourceId: subscriptionId,
      success: true,
      metadata: {
        plan: session.metadata?.plan,
        amount: payment.amount.toString(),
        currency: payment.currency,
      },
    });

    logger.info('Premium subscription activated', { 
      userId, 
      subscriptionId, 
      plan: session.metadata?.plan 
    });

  } catch (error) {
    logger.error('Failed to handle successful payment:', error);
    throw error;
  }
}

/**
 * Handle subscription cancellation
 */
export async function handleSubscriptionCancellation(subscriptionId: string): Promise<void> {
  try {
    const payment = await prisma.payment.findFirst({
      where: { externalId: subscriptionId },
      include: { user: true },
    });

    if (!payment) {
      logger.warn('Payment record not found for cancelled subscription', { subscriptionId });
      return;
    }

    // Update payment status
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    // Update user premium status (expires at end of current period)
    const stripeClient = getStripe();
    const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
    
    await prisma.user.update({
      where: { id: payment.userId },
      data: {
        isPremium: subscription.status === 'active', // Keep premium until period ends
        premiumUntil: new Date(subscription.current_period_end * 1000),
      },
    });

    logAuditEvent({
      actorId: payment.userId,
      action: 'cancel_subscription',
      resource: 'subscription',
      resourceId: subscriptionId,
      success: true,
    });

    logger.info('Subscription cancelled', { userId: payment.userId, subscriptionId });

  } catch (error) {
    logger.error('Failed to handle subscription cancellation:', error);
    throw error;
  }
}

/**
 * Process Stripe webhook
 */
export async function processStripeWebhook(
  payload: string,
  signature: string
): Promise<{ processed: boolean; eventType: string }> {
  try {
    const stripeClient = getStripe();
    const webhookSecret = config.payments.stripe.webhookSecret;

    if (!webhookSecret) {
      throw new Error('Webhook secret not configured');
    }

    // Verify webhook signature
    const event = stripeClient.webhooks.constructEvent(payload, signature, webhookSecret);
    
    logger.info('Stripe webhook received', { type: event.type, id: event.id });

    // Process event based on type
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          await handleSuccessfulPayment(session.id, session.subscription as string);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        if (subscription.status === 'active') {
          // Handle subscription renewal or reactivation
          const payment = await prisma.payment.findFirst({
            where: { externalId: subscription.id },
          });
          
          if (payment) {
            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: 'ACTIVE',
                renewsAt: new Date(subscription.current_period_end * 1000),
              },
            });
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCancellation(subscription.id);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          // Handle failed payment - could send notification to user
          logger.warn('Subscription payment failed', { 
            subscriptionId: invoice.subscription 
          });
        }
        break;
      }

      default:
        logger.debug('Unhandled Stripe webhook event', { type: event.type });
    }

    return { processed: true, eventType: event.type };

  } catch (error) {
    logger.error('Stripe webhook processing failed:', error);
    throw error;
  }
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(userId: string): Promise<void> {
  try {
    const stripeClient = getStripe();
    
    const payment = await prisma.payment.findFirst({
      where: { 
        userId, 
        status: 'ACTIVE',
        provider: 'STRIPE',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment?.externalId) {
      throw new Error('Active subscription not found');
    }

    // Cancel at period end (user keeps access until renewal date)
    await stripeClient.subscriptions.update(payment.externalId, {
      cancel_at_period_end: true,
    });

    logger.info('Subscription cancellation scheduled', { userId, subscriptionId: payment.externalId });

  } catch (error) {
    logger.error('Failed to cancel subscription:', error);
    throw new Error('Subscription cancellation failed');
  }
}

/**
 * Get user's subscription status
 */
export async function getSubscriptionStatus(userId: string): Promise<{
  isActive: boolean;
  plan?: string;
  renewsAt?: Date;
  cancelAtPeriodEnd?: boolean;
}> {
  try {
    const payment = await prisma.payment.findFirst({
      where: { 
        userId, 
        status: { in: ['ACTIVE', 'CANCELLED'] },
        provider: 'STRIPE',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment || !payment.externalId) {
      return { isActive: false };
    }

    // Check current status in Stripe
    const stripeClient = getStripe();
    const subscription = await stripeClient.subscriptions.retrieve(payment.externalId);

    return {
      isActive: subscription.status === 'active',
      plan: payment.plan.toLowerCase(),
      renewsAt: payment.renewsAt || undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    };

  } catch (error) {
    logger.error('Failed to get subscription status:', error);
    throw new Error('Failed to retrieve subscription status');
  }
}