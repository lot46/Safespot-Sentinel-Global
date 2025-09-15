/**
 * SafeSpot Sentinel Global V2 - Observability & Monitoring
 * OpenTelemetry tracing, Prometheus metrics, structured logging
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry instrumentation
 */
export async function initializeObservability(): Promise<void> {
  try {
    if (config.app.isProduction && config.monitoring.jaeger.endpoint) {
      // Initialize OpenTelemetry SDK
      sdk = new NodeSDK({
        resource: new Resource({
          [SemanticResourceAttributes.SERVICE_NAME]: config.app.name,
          [SemanticResourceAttributes.SERVICE_VERSION]: config.app.version,
          [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.app.env,
        }),
        instrumentations: [getNodeAutoInstrumentations({
          // Disable fs instrumentation for performance
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
          // Configure HTTP instrumentation
          '@opentelemetry/instrumentation-http': {
            ignoreIncomingRequestHook: (req) => {
              const url = req.url || '';
              // Ignore health checks and metrics
              return url.includes('/health') || url.includes('/metrics');
            },
          },
        })],
      });

      sdk.start();
      logger.info('✅ OpenTelemetry initialized');
    } else {
      logger.info('📊 OpenTelemetry disabled (development mode)');
    }
  } catch (error) {
    logger.error('Failed to initialize OpenTelemetry:', error);
  }
}

/**
 * Shutdown observability
 */
export async function shutdownObservability(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      logger.info('📊 OpenTelemetry shutdown complete');
    } catch (error) {
      logger.error('OpenTelemetry shutdown error:', error);
    }
  }
}

/**
 * Custom metrics for Prometheus
 */
export class MetricsCollector {
  private static metrics = new Map<string, any>();

  static increment(name: string, labels: Record<string, string> = {}): void {
    const key = `${name}_${JSON.stringify(labels)}`;
    const current = this.metrics.get(key) || 0;
    this.metrics.set(key, current + 1);
  }

  static gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = `${name}_${JSON.stringify(labels)}`;
    this.metrics.set(key, value);
  }

  static histogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = `${name}_histogram_${JSON.stringify(labels)}`;
    const current = this.metrics.get(key) || [];
    current.push(value);
    this.metrics.set(key, current);
  }

  static getMetrics(): Map<string, any> {
    return new Map(this.metrics);
  }

  static reset(): void {
    this.metrics.clear();
  }
}

/**
 * Application performance monitoring
 */
export class APMTracker {
  private startTime: number;
  private operation: string;
  private metadata: Record<string, any>;

  constructor(operation: string, metadata: Record<string, any> = {}) {
    this.startTime = Date.now();
    this.operation = operation;
    this.metadata = metadata;
  }

  finish(success: boolean = true, error?: Error): void {
    const duration = Date.now() - this.startTime;
    
    // Log performance data
    logger.info('Performance tracked', {
      operation: this.operation,
      duration,
      success,
      error: error?.message,
      metadata: this.metadata,
    });

    // Collect metrics
    MetricsCollector.histogram('operation_duration_seconds', duration / 1000, {
      operation: this.operation,
      success: success.toString(),
    });

    MetricsCollector.increment('operation_total', {
      operation: this.operation,
      success: success.toString(),
    });
  }
}

/**
 * Track API request performance
 */
export function trackRequest(method: string, route: string, statusCode: number, duration: number): void {
  MetricsCollector.histogram('http_request_duration_seconds', duration / 1000, {
    method,
    route,
    status_code: statusCode.toString(),
  });

  MetricsCollector.increment('http_requests_total', {
    method,
    route,
    status_code: statusCode.toString(),
  });
}

/**
 * Track SOS events
 */
export function trackSOSEvent(eventType: 'started' | 'ended' | 'cancelled', userId: string): void {
  MetricsCollector.increment('sos_events_total', {
    event_type: eventType,
    user_premium: 'unknown', // Would need to check user premium status
  });

  logger.info('SOS event tracked', {
    eventType,
    userId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track report events
 */
export function trackReportEvent(eventType: 'created' | 'moderated' | 'voted', reportType: string): void {
  MetricsCollector.increment('reports_total', {
    event_type: eventType,
    report_type: reportType.toLowerCase(),
  });
}

/**
 * Track authentication events
 */
export function trackAuthEvent(eventType: 'login' | 'register' | 'logout' | '2fa_enabled', success: boolean): void {
  MetricsCollector.increment('auth_events_total', {
    event_type: eventType,
    success: success.toString(),
  });
}

/**
 * Track payment events
 */
export function trackPaymentEvent(eventType: 'checkout_created' | 'payment_completed' | 'subscription_cancelled', plan?: string): void {
  MetricsCollector.increment('payment_events_total', {
    event_type: eventType,
    plan: plan || 'unknown',
  });
}

/**
 * Track WebSocket connections
 */
export function trackWebSocketEvent(eventType: 'connected' | 'disconnected' | 'authenticated'): void {
  MetricsCollector.increment('websocket_events_total', {
    event_type: eventType,
  });
}

/**
 * Health check with detailed metrics
 */
export async function getSystemHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, { status: 'pass' | 'fail'; responseTime?: number; details?: any }>;
  timestamp: string;
}> {
  const checks: Record<string, any> = {};
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  // Database health check
  try {
    const start = Date.now();
    const { checkDatabaseHealth } = await import('../database/index.js');
    const dbHealthy = await checkDatabaseHealth();
    const responseTime = Date.now() - start;

    checks.database = {
      status: dbHealthy ? 'pass' : 'fail',
      responseTime,
    };

    if (!dbHealthy) overallStatus = 'unhealthy';
  } catch (error) {
    checks.database = { status: 'fail', details: error.message };
    overallStatus = 'unhealthy';
  }

  // Redis health check
  try {
    const start = Date.now();
    const { checkRedisHealth } = await import('../cache/redis.js');
    const redisHealthy = await checkRedisHealth();
    const responseTime = Date.now() - start;

    checks.redis = {
      status: redisHealthy ? 'pass' : 'fail',
      responseTime,
    };

    if (!redisHealthy) {
      overallStatus = overallStatus === 'unhealthy' ? 'unhealthy' : 'degraded';
    }
  } catch (error) {
    checks.redis = { status: 'fail', details: error.message };
    overallStatus = overallStatus === 'unhealthy' ? 'unhealthy' : 'degraded';
  }

  // Memory check
  const memUsage = process.memoryUsage();
  const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  
  checks.memory = {
    status: memUsagePercent < 90 ? 'pass' : 'fail',
    details: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      usagePercent: Math.round(memUsagePercent),
    },
  };

  if (memUsagePercent >= 95) {
    overallStatus = 'unhealthy';
  } else if (memUsagePercent >= 85) {
    overallStatus = overallStatus === 'unhealthy' ? 'unhealthy' : 'degraded';
  }

  return {
    status: overallStatus,
    checks,
    timestamp: new Date().toISOString(),
  };
}