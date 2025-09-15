/**
 * SafeSpot Sentinel Global V2 - Two-Factor Authentication
 * TOTP-based 2FA with backup codes and SMS fallback
 */

import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { encrypt, decrypt, generate2FABackupCodes, hashPassword } from '../security/encryption.js';
import { getPrisma } from '../database/index.js';
import { sendSMS } from '../integrations/sms.js';
import { setCache, getCache, deleteCache } from '../cache/redis.js';

const prisma = getPrisma();

// Configure TOTP settings
authenticator.options = {
  step: 30, // 30 second window
  window: 2, // Allow 2 windows before/after for clock skew
};

export interface TwoFASetup {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
  manualEntryKey: string;
}

export interface TwoFAVerification {
  isValid: boolean;
  method: '2fa' | 'backup' | 'sms';
  remaining?: number; // For backup codes
}

/**
 * Generate 2FA secret and setup data for user
 */
export async function generate2FASetup(userId: string, email: string): Promise<TwoFASetup> {
  try {
    // Generate secret
    const secret = authenticator.generateSecret();
    
    // Create service name and account name
    const serviceName = config.app.name;
    const accountName = email;
    
    // Generate TOTP URL
    const otpauthUrl = authenticator.keyuri(accountName, serviceName, secret);
    
    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);
    
    // Generate backup codes
    const backupCodes = generate2FABackupCodes();
    
    // Format manual entry key (groups of 4 characters)
    const manualEntryKey = secret.match(/.{1,4}/g)?.join(' ') || secret;
    
    // Store encrypted secret and backup codes temporarily (user must verify before saving)
    const encryptedSecret = await encrypt(secret);
    const encryptedBackupCodes = await Promise.all(
      backupCodes.map(code => hashPassword(code)) // Hash backup codes like passwords
    );
    
    await setCache(`2fa_setup:${userId}`, {
      secret: encryptedSecret,
      backupCodes: encryptedBackupCodes,
      createdAt: new Date().toISOString(),
    }, { ttl: 600, prefix: 'auth' }); // 10 minutes to complete setup
    
    logger.info('2FA setup generated', { userId });
    
    return {
      secret,
      qrCodeUrl,
      backupCodes, // Return plaintext codes for user to save
      manualEntryKey,
    };
    
  } catch (error) {
    logger.error('2FA setup generation failed:', error);
    throw new Error('Failed to generate 2FA setup');
  }
}

/**
 * Verify 2FA token during setup
 */
export async function verify2FASetup(userId: string, token: string): Promise<boolean> {
  try {
    const setupData = await getCache<{
      secret: string;
      backupCodes: string[];
      createdAt: string;
    }>(`2fa_setup:${userId}`, { prefix: 'auth' });
    
    if (!setupData) {
      throw new Error('2FA setup not found or expired');
    }
    
    // Decrypt secret
    const secret = await decrypt(setupData.secret);
    
    // Verify token
    const isValid = authenticator.verify({ token, secret });
    
    if (isValid) {
      // Save 2FA settings to database
      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFAEnabled: true,
          twoFASecret: setupData.secret, // Store encrypted
          twoFABackupCodes: setupData.backupCodes, // Store hashed
        },
      });
      
      // Clean up temporary setup data
      await deleteCache(`2fa_setup:${userId}`, { prefix: 'auth' });
      
      logger.info('2FA setup completed', { userId });
    }
    
    return isValid;
    
  } catch (error) {
    logger.error('2FA setup verification failed:', error);
    throw new Error('2FA setup verification failed');
  }
}

/**
 * Verify 2FA token for login
 */
export async function verify2FA(userId: string, token: string): Promise<TwoFAVerification> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        twoFAEnabled: true,
        twoFASecret: true,
        twoFABackupCodes: true,
      },
    });
    
    if (!user || !user.twoFAEnabled || !user.twoFASecret) {
      throw new Error('2FA not enabled for user');
    }
    
    // Check rate limiting for 2FA attempts
    const rateLimitKey = `2fa_attempts:${userId}`;
    const attempts = await getCache<{ count: number; lockedUntil?: number }>(rateLimitKey, { prefix: 'auth' });
    
    if (attempts && attempts.lockedUntil && attempts.lockedUntil > Date.now()) {
      throw new Error('2FA temporarily locked due to too many failed attempts');
    }
    
    // First try TOTP verification
    const secret = await decrypt(user.twoFASecret);
    const isTOTPValid = authenticator.verify({ token, secret });
    
    if (isTOTPValid) {
      // Reset failed attempts on successful verification
      await deleteCache(rateLimitKey, { prefix: 'auth' });
      
      logger.info('2FA TOTP verification successful', { userId });
      return { isValid: true, method: '2fa' };
    }
    
    // If TOTP fails, try backup codes
    if (user.twoFABackupCodes && user.twoFABackupCodes.length > 0) {
      for (let i = 0; i < user.twoFABackupCodes.length; i++) {
        const bcrypt = await import('bcrypt');
        const isBackupValid = await bcrypt.compare(token, user.twoFABackupCodes[i]);
        
        if (isBackupValid) {
          // Remove used backup code
          const updatedBackupCodes = [...user.twoFABackupCodes];
          updatedBackupCodes.splice(i, 1);
          
          await prisma.user.update({
            where: { id: userId },
            data: { twoFABackupCodes: updatedBackupCodes },
          });
          
          // Reset failed attempts
          await deleteCache(rateLimitKey, { prefix: 'auth' });
          
          logger.info('2FA backup code verification successful', { userId, remaining: updatedBackupCodes.length });
          return { 
            isValid: true, 
            method: 'backup', 
            remaining: updatedBackupCodes.length 
          };
        }
      }
    }
    
    // Track failed attempt
    const newAttempts = (attempts?.count || 0) + 1;
    const lockUntil = newAttempts >= 5 ? Date.now() + (15 * 60 * 1000) : undefined; // 15 min lockout after 5 attempts
    
    await setCache(rateLimitKey, {
      count: newAttempts,
      lockedUntil: lockUntil,
    }, { ttl: 900, prefix: 'auth' }); // 15 minutes
    
    logger.warn('2FA verification failed', { userId, attempts: newAttempts, locked: !!lockUntil });
    
    return { isValid: false, method: '2fa' };
    
  } catch (error) {
    logger.error('2FA verification failed:', error);
    throw error;
  }
}

/**
 * Generate and send SMS 2FA code
 */
export async function sendSMS2FA(userId: string, phoneNumber: string): Promise<void> {
  try {
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store code with expiration
    await setCache(`sms_2fa:${userId}`, {
      code: await hashPassword(code), // Hash the code
      phoneNumber,
      createdAt: new Date().toISOString(),
    }, { ttl: 300, prefix: 'auth' }); // 5 minutes
    
    // Send SMS
    const message = `Your SafeSpot Sentinel security code is: ${code}. This code expires in 5 minutes.`;
    await sendSMS(phoneNumber, message);
    
    logger.info('SMS 2FA code sent', { userId, phoneNumber: phoneNumber.replace(/\d(?=\d{4})/g, '*') });
    
  } catch (error) {
    logger.error('SMS 2FA sending failed:', error);
    throw new Error('Failed to send SMS 2FA code');
  }
}

/**
 * Verify SMS 2FA code
 */
export async function verifySMS2FA(userId: string, code: string): Promise<TwoFAVerification> {
  try {
    const smsData = await getCache<{
      code: string;
      phoneNumber: string;
      createdAt: string;
    }>(`sms_2fa:${userId}`, { prefix: 'auth' });
    
    if (!smsData) {
      throw new Error('SMS 2FA code not found or expired');
    }
    
    // Verify code
    const bcrypt = await import('bcrypt');
    const isValid = await bcrypt.compare(code, smsData.code);
    
    if (isValid) {
      // Clean up used code
      await deleteCache(`sms_2fa:${userId}`, { prefix: 'auth' });
      
      logger.info('SMS 2FA verification successful', { userId });
      return { isValid: true, method: 'sms' };
    }
    
    logger.warn('SMS 2FA verification failed', { userId });
    return { isValid: false, method: 'sms' };
    
  } catch (error) {
    logger.error('SMS 2FA verification failed:', error);
    throw error;
  }
}

/**
 * Disable 2FA for user
 */
export async function disable2FA(userId: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFAEnabled: false,
        twoFASecret: null,
        twoFABackupCodes: [],
      },
    });
    
    // Clean up any pending setups
    await deleteCache(`2fa_setup:${userId}`, { prefix: 'auth' });
    await deleteCache(`2fa_attempts:${userId}`, { prefix: 'auth' });
    
    logger.info('2FA disabled', { userId });
    
  } catch (error) {
    logger.error('2FA disable failed:', error);
    throw new Error('Failed to disable 2FA');
  }
}

/**
 * Generate new backup codes
 */
export async function regenerateBackupCodes(userId: string): Promise<string[]> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFAEnabled: true },
    });
    
    if (!user?.twoFAEnabled) {
      throw new Error('2FA not enabled for user');
    }
    
    // Generate new backup codes
    const backupCodes = generate2FABackupCodes();
    const hashedBackupCodes = await Promise.all(
      backupCodes.map(code => hashPassword(code))
    );
    
    // Update in database
    await prisma.user.update({
      where: { id: userId },
      data: { twoFABackupCodes: hashedBackupCodes },
    });
    
    logger.info('2FA backup codes regenerated', { userId });
    
    return backupCodes; // Return plaintext for user to save
    
  } catch (error) {
    logger.error('Backup codes regeneration failed:', error);
    throw new Error('Failed to regenerate backup codes');
  }
}

/**
 * Get 2FA status for user
 */
export async function get2FAStatus(userId: string): Promise<{
  enabled: boolean;
  backupCodesRemaining: number;
}> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        twoFAEnabled: true,
        twoFABackupCodes: true,
      },
    });
    
    return {
      enabled: user?.twoFAEnabled || false,
      backupCodesRemaining: user?.twoFABackupCodes?.length || 0,
    };
    
  } catch (error) {
    logger.error('Failed to get 2FA status:', error);
    throw new Error('Failed to get 2FA status');
  }
}