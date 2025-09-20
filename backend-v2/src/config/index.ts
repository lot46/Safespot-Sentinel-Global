/**
 * SafeSpot Sentinel Global V2 - Configuration Management
 * Centralized configuration with environment validation using Zod
 */

import { z } from 'zod';

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default(8002),
  APP_NAME: z.string().default('SafeSpot Sentinel Global V2'),
  APP_VERSION: z.string().default('2.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),
  
  // Redis
  REDIS_URL: z.string().url(),

  // Security & Auth
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z.string().length(32),
  BCRYPT_ROUNDS: z.string().transform(Number).default(12),

  // OAuth2
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),

  // CORS
  CORS_ORIGINS: z.string().default('*'),
  FRONTEND_URL: z.string().url(),

  // Rate Limiting
  RATE_LIMIT_MAX: z.string().transform(Number).default(100),
  RATE_LIMIT_WINDOW: z.string().transform(Number).default(900000),

  // File Storage (S3)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  MEDIA_MAX_SIZE: z.string().transform(Number).default(10485760), // 10MB
  MEDIA_ALLOWED_TYPES: z.string().default('image/jpeg,image/png,image/webp,video/mp4'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PREMIUM_MONTHLY_PRICE_ID: z.string().optional(),
  STRIPE_PREMIUM_YEARLY_PRICE_ID: z.string().optional(),

  // Weather API
  OPENWEATHER_API_KEY: z.string().optional(),
  WEATHER_UPDATE_INTERVAL: z.string().transform(Number).default('300000'), // 5 minutes

  // Firebase
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),

  // Email & SMS
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).default('587'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // Monitoring
  JAEGER_ENDPOINT: z.string().url().optional(),
  PROMETHEUS_ENDPOINT: z.string().url().optional(),

  // GDPR & Privacy
  DATA_RETENTION_REPORTS_MONTHS: z.string().transform(Number).default('18'),
  DATA_RETENTION_LOGS_MONTHS: z.string().transform(Number).default('6'),
  DATA_RETENTION_SOS_SESSIONS_DAYS: z.string().transform(Number).default('30'),
  GDPR_DPO_EMAIL: z.string().email().optional(),
});

const env = envSchema.parse(process.env);

export const config = {
  app: {
    name: env.APP_NAME,
    version: env.APP_VERSION,
    env: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    logLevel: env.LOG_LEVEL,
  },

  server: {
    port: env.PORT,
    host: '0.0.0.0',
    frontendUrl: env.FRONTEND_URL,
    corsOrigins: env.CORS_ORIGINS.split(','),
    maxPayloadSize: 1024 * 1024 * 50, // 50MB
  },

  database: {
    url: env.DATABASE_URL,
  },

  redis: {
    url: env.REDIS_URL,
  },

  security: {
    jwt: {
      secret: env.JWT_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
    encryption: {
      key: env.ENCRYPTION_KEY,
    },
    bcrypt: {
      rounds: env.BCRYPT_ROUNDS,
    },
    rateLimit: {
      max: env.RATE_LIMIT_MAX,
      window: env.RATE_LIMIT_WINDOW,
    },
  },

  oauth: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    apple: {
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: env.APPLE_CLIENT_SECRET,
    },
  },

  storage: {
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
    },
    media: {
      maxSize: env.MEDIA_MAX_SIZE,
      allowedTypes: env.MEDIA_ALLOWED_TYPES.split(','),
    },
  },

  payments: {
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      premiumMonthlyPriceId: env.STRIPE_PREMIUM_MONTHLY_PRICE_ID,
      premiumYearlyPriceId: env.STRIPE_PREMIUM_YEARLY_PRICE_ID,
    },
  },

  integrations: {
    weather: {
      apiKey: env.OPENWEATHER_API_KEY,
      updateInterval: env.WEATHER_UPDATE_INTERVAL,
    },
    firebase: {
      projectId: env.FIREBASE_PROJECT_ID,
      privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
    },
    email: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM,
    },
    sms: {
      twilio: {
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        phoneNumber: env.TWILIO_PHONE_NUMBER,
      },
    },
  },

  monitoring: {
    jaeger: {
      endpoint: env.JAEGER_ENDPOINT,
    },
    prometheus: {
      endpoint: env.PROMETHEUS_ENDPOINT,
    },
  },

  gdpr: {
    dataRetention: {
      reportsMonths: env.DATA_RETENTION_REPORTS_MONTHS,
      logsMonths: env.DATA_RETENTION_LOGS_MONTHS,
      sosSessionsDays: env.DATA_RETENTION_SOS_SESSIONS_DAYS,
    },
    dpoEmail: env.GDPR_DPO_EMAIL,
  },
} as const;

export type Config = typeof config;