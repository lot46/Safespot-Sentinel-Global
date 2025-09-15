/**
 * SafeSpot Sentinel Global V2 - SMS Integration
 * Multi-provider SMS with fallback and rate limiting
 */

import { config } from '../config/index.js';
import { logger, logSecurityEvent } from '../utils/logger.js';
import { checkRateLimit } from '../cache/redis.js';

// SMS Provider interface
interface SMSProvider {
  name: string;
  send(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

// Twilio SMS Provider
class TwilioProvider implements SMSProvider {
  name = 'twilio';
  private client: any;

  constructor() {
    if (config.integrations.sms.twilio.accountSid && config.integrations.sms.twilio.authToken) {
      this.initClient();
    }
  }

  private async initClient() {
    try {
      const twilio = await import('twilio');
      this.client = twilio.default(
        config.integrations.sms.twilio.accountSid,
        config.integrations.sms.twilio.authToken
      );
      logger.info('✅ Twilio SMS provider initialized');
    } catch (error) {
      logger.error('Failed to initialize Twilio:', error);
    }
  }

  async send(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.client) {
      return { success: false, error: 'Twilio not configured' };
    }

    try {
      const result = await this.client.messages.create({
        body: message,
        from: config.integrations.sms.twilio.phoneNumber,
        to: to,
      });

      return { success: true, messageId: result.sid };
    } catch (error: any) {
      logger.error('Twilio SMS failed:', error);
      return { success: false, error: error.message };
    }
  }
}

// Mock SMS Provider for development/testing
class MockSMSProvider implements SMSProvider {
  name = 'mock';

  async send(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    logger.info('📱 Mock SMS sent', { to: to.replace(/\d(?=\d{4})/g, '*'), message });
    
    // Simulate random failures for testing
    if (Math.random() < 0.05) { // 5% failure rate
      return { success: false, error: 'Mock SMS delivery failed' };
    }

    return { success: true, messageId: `mock_${Date.now()}` };
  }
}

// Available providers
const providers: SMSProvider[] = [
  new TwilioProvider(),
  new MockSMSProvider(), // Fallback for development
];

/**
 * Send SMS with provider fallback and rate limiting
 */
export async function sendSMS(
  phoneNumber: string, 
  message: string,
  options: {
    priority?: 'low' | 'normal' | 'high' | 'emergency';
    maxRetries?: number;
    bypassRateLimit?: boolean;
  } = {}
): Promise<{ success: boolean; provider?: string; messageId?: string; error?: string }> {
  const { priority = 'normal', maxRetries = 2, bypassRateLimit = false } = options;

  try {
    // Validate phone number format
    if (!isValidPhoneNumber(phoneNumber)) {
      throw new Error('Invalid phone number format');
    }

    // Check rate limits (unless bypassed for emergencies)
    if (!bypassRateLimit) {
      const rateLimit = await checkRateLimit(
        `sms:${phoneNumber}`, 
        priority === 'emergency' ? 100 : priority === 'high' ? 20 : 5, // Different limits by priority
        3600000, // 1 hour window
        'sms_rate_limit'
      );

      if (!rateLimit.allowed) {
        logSecurityEvent({
          type: 'rate_limit_exceeded',
          severity: 'medium',
          source: `sms:${phoneNumber}`,
          metadata: { phoneNumber: phoneNumber.replace(/\d(?=\d{4})/g, '*'), priority },
        });
        
        throw new Error('SMS rate limit exceeded');
      }
    }

    // Try providers with fallback
    let lastError: string | undefined;
    
    for (const provider of providers) {
      try {
        logger.debug(`Attempting SMS via ${provider.name}`, { 
          to: phoneNumber.replace(/\d(?=\d{4})/g, '*'),
          priority 
        });

        const result = await provider.send(phoneNumber, message);
        
        if (result.success) {
          logger.info('SMS sent successfully', { 
            provider: provider.name,
            to: phoneNumber.replace(/\d(?=\d{4})/g, '*'),
            messageId: result.messageId,
            priority
          });

          return {
            success: true,
            provider: provider.name,
            messageId: result.messageId,
          };
        } else {
          lastError = result.error;
          logger.warn(`SMS failed via ${provider.name}:`, result.error);
        }
      } catch (error: any) {
        lastError = error.message;
        logger.warn(`SMS provider ${provider.name} threw error:`, error);
      }
    }

    // All providers failed
    logger.error('All SMS providers failed', { 
      to: phoneNumber.replace(/\d(?=\d{4})/g, '*'),
      lastError,
      priority 
    });

    return { success: false, error: lastError || 'All SMS providers failed' };

  } catch (error: any) {
    logger.error('SMS sending failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send emergency SOS SMS
 */
export async function sendEmergencySMS(
  phoneNumber: string,
  userLocation: { latitude: number; longitude: number },
  userName: string,
  message?: string
): Promise<{ success: boolean; error?: string }> {
  const defaultMessage = `URGENCE SafeSpot Sentinel - ${userName} a besoin d'aide immédiatement ! Position: ${userLocation.latitude.toFixed(6)}, ${userLocation.longitude.toFixed(6)}. Lien de suivi: https://maps.google.com/maps?q=${userLocation.latitude},${userLocation.longitude}`;
  
  const smsText = message ? `${message}\n\n${defaultMessage}` : defaultMessage;

  const result = await sendSMS(phoneNumber, smsText, {
    priority: 'emergency',
    bypassRateLimit: true, // Emergency SMS bypass rate limits
    maxRetries: 3,
  });

  return { success: result.success, error: result.error };
}

/**
 * Send 2FA verification SMS
 */
export async function send2FASMS(phoneNumber: string, code: string): Promise<{ success: boolean; error?: string }> {
  const message = `Votre code de vérification SafeSpot Sentinel: ${code}. Ce code expire dans 5 minutes. Ne le partagez jamais.`;

  const result = await sendSMS(phoneNumber, message, {
    priority: 'high',
    maxRetries: 2,
  });

  return { success: result.success, error: result.error };
}

/**
 * Send notification SMS
 */
export async function sendNotificationSMS(
  phoneNumber: string,
  title: string,
  body: string
): Promise<{ success: boolean; error?: string }> {
  const message = `SafeSpot Sentinel - ${title}: ${body}`;

  const result = await sendSMS(phoneNumber, message, {
    priority: 'normal',
  });

  return { success: result.success, error: result.error };
}

/**
 * Validate phone number format
 */
function isValidPhoneNumber(phoneNumber: string): boolean {
  // Basic E.164 format validation
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(phoneNumber);
}

/**
 * Format phone number for display (mask digits)
 */
export function maskPhoneNumber(phoneNumber: string): string {
  if (phoneNumber.length < 4) {
    return phoneNumber;
  }
  
  return phoneNumber.replace(/\d(?=\d{4})/g, '*');
}

/**
 * Get SMS provider status
 */
export async function getSMSProviderStatus(): Promise<{
  providers: Array<{
    name: string;
    available: boolean;
    lastError?: string;
  }>;
  activeProvider?: string;
}> {
  const providerStatus = await Promise.all(
    providers.map(async (provider) => {
      try {
        // Test with a mock number for status check
        const testResult = provider.name === 'mock' 
          ? { success: true }
          : await provider.send('+1234567890', 'Test').catch(() => ({ success: false, error: 'Connection failed' }));
        
        return {
          name: provider.name,
          available: testResult.success,
          lastError: testResult.success ? undefined : 'Connection test failed',
        };
      } catch (error: any) {
        return {
          name: provider.name,
          available: false,
          lastError: error.message,
        };
      }
    })
  );

  const activeProvider = providerStatus.find(p => p.available)?.name;

  return {
    providers: providerStatus,
    activeProvider,
  };
}