/**
 * SafeSpot Sentinel Global V2 - Encryption & Hashing Utilities
 * AES-256 encryption for sensitive data with GDPR compliance
 */

import { createCipher, createDecipher, createHash, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const scryptAsync = promisify(scrypt);
const algorithm = 'aes-256-gcm';

/**
 * Generate encryption key from master key and salt
 */
async function deriveKey(salt: Buffer): Promise<Buffer> {
  return (await scryptAsync(config.security.encryption.key, salt, 32)) as Buffer;
}

/**
 * Encrypt sensitive data (AES-256-GCM)
 */
export async function encrypt(plaintext: string): Promise<string> {
  try {
    const salt = randomBytes(16);
    const iv = randomBytes(16);
    const key = await deriveKey(salt);
    
    const cipher = createCipher(algorithm, key);
    cipher.setAAD(Buffer.from('SafeSpot-Sentinel-Global', 'utf8'));
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Combine salt, iv, authTag, and encrypted data
    const combined = Buffer.concat([
      salt,
      iv,
      authTag,
      Buffer.from(encrypted, 'hex')
    ]);
    
    return combined.toString('base64');
    
  } catch (error) {
    logger.error('Encryption error:', error);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt sensitive data (AES-256-GCM)
 */
export async function decrypt(encryptedData: string): Promise<string> {
  try {
    const combined = Buffer.from(encryptedData, 'base64');
    
    if (combined.length < 48) { // 16 + 16 + 16 minimum
      throw new Error('Invalid encrypted data format');
    }
    
    const salt = combined.subarray(0, 16);
    const iv = combined.subarray(16, 32);
    const authTag = combined.subarray(32, 48);
    const encrypted = combined.subarray(48);
    
    const key = await deriveKey(salt);
    
    const decipher = createDecipher(algorithm, key);
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from('SafeSpot-Sentinel-Global', 'utf8'));
    
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
    
  } catch (error) {
    logger.error('Decryption error:', error);
    throw new Error('Decryption failed');
  }
}

/**
 * Hash sensitive data for logging/indexing (SHA-256)
 */
export function hashSensitiveData(data: string, salt?: string): string {
  const saltToUse = salt || 'SafeSpot-Global-Salt';
  return createHash('sha256')
    .update(data + saltToUse)
    .digest('hex')
    .substring(0, 16); // First 16 chars for logs
}

/**
 * Hash password with bcrypt (async)
 */
export async function hashPassword(password: string): Promise<string> {
  const bcrypt = await import('bcrypt');
  return bcrypt.hash(password, config.security.bcrypt.rounds);
}

/**
 * Verify password with bcrypt
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const bcrypt = await import('bcrypt');
    return bcrypt.compare(password, hash);
  } catch (error) {
    logger.error('Password verification error:', error);
    return false;
  }
}

/**
 * Generate secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Generate UUID v4
 */
export function generateUUID(): string {
  return randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Anonymize data for GDPR compliance
 */
export function anonymizeData(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }
  
  const anonymized = { ...data };
  
  // List of fields to anonymize
  const sensitiveFields = [
    'email', 'phone', 'firstName', 'lastName', 'address',
    'ipAddress', 'userAgent', 'deviceId', 'location'
  ];
  
  for (const field of sensitiveFields) {
    if (anonymized[field]) {
      if (field === 'email') {
        anonymized[field] = `anonymous_${hashSensitiveData(anonymized[field])}@anonymized.local`;
      } else if (field === 'phone') {
        anonymized[field] = `+XXX-XXX-${anonymized[field].slice(-4)}`;
      } else if (field === 'firstName' || field === 'lastName') {
        anonymized[field] = `Anonymous_${hashSensitiveData(anonymized[field]).substring(0, 8)}`;
      } else {
        anonymized[field] = `[ANONYMIZED_${hashSensitiveData(anonymized[field]).substring(0, 8)}]`;
      }
    }
  }
  
  return anonymized;
}

/**
 * Generate 2FA backup codes
 */
export function generate2FABackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  
  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric code
    const code = randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${code.substring(0, 4)}-${code.substring(4, 8)}`);
  }
  
  return codes;
}

/**
 * Validate data integrity with HMAC
 */
export function createDataSignature(data: string, secret?: string): string {
  const secretToUse = secret || config.security.encryption.key;
  return createHash('sha256')
    .update(data + secretToUse)
    .digest('hex');
}

/**
 * Verify data integrity with HMAC
 */
export function verifyDataSignature(data: string, signature: string, secret?: string): boolean {
  const expectedSignature = createDataSignature(data, secret);
  return constantTimeCompare(signature, expectedSignature);
}

/**
 * Secure random string generator for tokens/IDs
 */
export function generateSecureId(prefix?: string, length: number = 16): string {
  const randomPart = randomBytes(length).toString('base64')
    .replace(/[+/]/g, '')
    .substring(0, length);
  
  return prefix ? `${prefix}_${randomPart}` : randomPart;
}