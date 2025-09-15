/**
 * SafeSpot Sentinel Global V2 - Structured Logging
 * Pino-based logger with GDPR compliance and security event handling
 */

import pino from 'pino';
import { config } from '../config/index.js';

// Create logger instance
export const logger = pino({
  level: config.app.logLevel,
  
  // Production configuration
  ...(config.app.isProduction ? {
    // Structured JSON logging for production
    serializers: {
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
      err: pino.stdSerializers.err,
    },
    redact: {
      paths: [
        // Redact sensitive fields for GDPR compliance
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.token',
        'req.body.secret',
        'req.body.email',
        'req.body.phone',
        'user.email',
        'user.phone',
        'user.passwordHash',
        'user.twoFASecret',
        'payment.cardNumber',
        'payment.cvv',
      ],
      remove: true,
    },
  } : {
    // Pretty printing for development
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
        singleLine: true,
      },
    },
  }),

  // Base context
  base: {
    app: config.app.name,
    version: config.app.version,
    env: config.app.env,
  },
});

/**
 * Security event logger with enhanced tracking
 */
export const securityLogger = logger.child({ 
  component: 'security',
  // Security logs are never redacted
  serializers: {
    ...pino.stdSerializers,
    // Custom security event serializer
    securityEvent: (event: any) => ({
      type: event.type,
      severity: event.severity,
      source: event.source,
      timestamp: event.timestamp || new Date().toISOString(),
      // Hash sensitive data
      ipHash: event.ipAddress ? hashSensitiveData(event.ipAddress) : undefined,
      userAgentHash: event.userAgent ? hashSensitiveData(event.userAgent) : undefined,
      userId: event.userId,
      metadata: event.metadata || {},
    }),
  },
});

/**
 * Audit logger for compliance tracking
 */
export const auditLogger = logger.child({
  component: 'audit',
  serializers: {
    ...pino.stdSerializers,
    auditEvent: (event: any) => ({
      actor: {
        id: event.actorId,
        role: event.actorRole,
        ipHash: event.ipAddress ? hashSensitiveData(event.ipAddress) : undefined,
      },
      action: event.action,
      resource: event.resource,
      resourceId: event.resourceId,
      success: event.success,
      timestamp: event.timestamp || new Date().toISOString(),
      metadata: event.metadata || {},
    }),
  },
});

/**
 * Performance logger for monitoring
 */
export const performanceLogger = logger.child({
  component: 'performance',
});

/**
 * Hash sensitive data for privacy compliance
 */
function hashSensitiveData(data: string): string {
  // Simple hash for logging - don't use for authentication
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

/**
 * Log security events with proper classification
 */
export function logSecurityEvent(event: {
  type: 'failed_login' | 'suspicious_activity' | 'rate_limit_exceeded' | 'unauthorized_access' | 'data_breach' | 'account_locked';
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: string;
  ipAddress?: string;
  userAgent?: string;
  userId?: string;
  metadata?: Record<string, any>;
}) {
  securityLogger.warn({ securityEvent: event }, `Security event: ${event.type}`);
}

/**
 * Log audit events for compliance
 */
export function logAuditEvent(event: {
  actorId?: string;
  actorRole?: string;
  action: string;
  resource: string;
  resourceId?: string;
  success: boolean;
  ipAddress?: string;
  metadata?: Record<string, any>;
}) {
  auditLogger.info({ auditEvent: event }, `Audit: ${event.action} on ${event.resource}`);
}

/**
 * Log performance metrics
 */
export function logPerformance(event: {
  operation: string;
  duration: number;
  success: boolean;
  metadata?: Record<string, any>;
}) {
  performanceLogger.info(event, `Performance: ${event.operation} took ${event.duration}ms`);
}