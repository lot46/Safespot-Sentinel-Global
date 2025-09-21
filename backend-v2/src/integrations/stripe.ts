/**
 * SafeSpot Sentinel Global V2 - Stripe Payment Integration (behind flags)
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
  idempotencyKey?: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
  paymentStatus: string;
  subscriptionId?: string;
}

export function initializeStripe(): void {
  if (!config.payments.stripe.secretKey) {
    logger.warn('Stripe not configured - payment features disabled');
    return;
  }
  stripe = new Stripe(config.payments.stripe.secretKey, { apiVersion: '2023-10-16', typescript: true, telemetry: false });
  logger.info('✅ Stripe initialized');
}

function getStripe(): Stripe {
  if (!stripe) {
    initializeStripe();
    if (!stripe) throw new Error('Stripe not configured');
  }
  return stripe;
}

export async function createOrGetCustomer(userId: string, email: string, name: string): Promise<string> {
  try {
    const stripeClient = getStripe();
    const existingPayment = await prisma.payment.findFirst({ where: { userId, customerId: { not: null } }, select: { customerId: true } });
    if (existingPayment?.customerId) {
      try { await stripeClient.customers.retrieve(existingPayment.customerId); return existingPayment.customerId; } catch { logger.warn('Stripe customer not found, creating new one', { customerId: existingPayment.customerId }); }
    }
    const customer = await stripeClient.customers.create({ email, name, metadata: { userId, platform: 'SafeSpot Sentinel Global' } });
    logger.info('Stripe customer created', { userId, customerId: customer.id });
    return customer.id;
  } catch (error) {
    logger.error('Failed to create Stripe customer:', error);
    throw new Error('Customer creation failed');
  }
}

export async function createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSession> {
  try {
    const stripeClient = getStripe();

    // Idempotency cache check (10 minutes)
    if (params.idempotencyKey) {
      const cached = await getCache<CheckoutSession>(`idemp:${params.idempotencyKey}`, { prefix: 'payments' });
      if (cached) return cached;
    }

    const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { email: true, firstName: true, lastName: true } });
    if (!user) throw new Error('User not found');

    const customerId = await createOrGetCustomer(params.userId, user.email, `${user.firstName} ${user.lastName}`);

    const priceId = params.plan === 'premium_monthly' ? config.payments.stripe.premiumMonthlyPriceId : config.payments.stripe.premiumYearlyPriceId;
    if (!priceId) throw new Error(`Price ID not configured for plan: ${params.plan}`);

    const session = await stripeClient.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${params.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: params.cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      metadata: { userId: params.userId, plan: params.plan, ...params.metadata },
      subscription_data: { metadata: { userId: params.userId, plan: params.plan } },
    }, params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined);

    await prisma.payment.create({ data: { userId: params.userId, plan: params.plan.toUpperCase() as any, provider: 'STRIPE', externalId: session.id, customerId, amount: params.plan === 'premium_monthly' ? 9.99 : 99.99, currency: 'EUR', status: 'PENDING', metadata: params.metadata || {} } });

    const summary: CheckoutSession = { id: session.id, url: session.url!, paymentStatus: session.payment_status, subscriptionId: session.subscription as string | undefined };
    if (params.idempotencyKey) await setCache(`idemp:${params.idempotencyKey}`, summary, { ttl: 600, prefix: 'payments' });

    logger.info('Checkout session created', { userId: params.userId, sessionId: session.id });
    return summary;
  } catch (error) {
    logger.error('Failed to create checkout session:', error);
    throw new Error('Checkout session creation failed');
  }
}