/**
 * SafeSpot Sentinel Global V2 - Email Integration
 * Transactional email with templates and deliverability tracking
 */

import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { checkRateLimit } from '../cache/redis.js';

// Email template types
export type EmailTemplate = 
  | 'welcome'
  | 'email_verification'
  | 'password_reset'
  | 'sos_alert'
  | '2fa_backup_codes'
  | 'premium_welcome'
  | 'premium_cancelled'
  | 'security_alert'
  | 'account_locked';

interface EmailData {
  to: string;
  template: EmailTemplate;
  data: Record<string, any>;
  priority?: 'low' | 'normal' | 'high' | 'emergency';
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// Email transporter
let transporter: nodemailer.Transporter | null = null;

/**
 * Initialize email transporter
 */
export function initializeEmail(): void {
  if (!config.integrations.email.host) {
    logger.warn('Email not configured - email features disabled');
    return;
  }

  try {
    transporter = nodemailer.createTransporter({
      host: config.integrations.email.host,
      port: config.integrations.email.port,
      secure: config.integrations.email.port === 465,
      auth: {
        user: config.integrations.email.user,
        pass: config.integrations.email.pass,
      },
      pool: true, // Use connection pooling
      maxConnections: 5,
      maxMessages: 100,
      rateLimit: 10, // Max 10 emails per second
    });

    logger.info('✅ Email transporter initialized');
  } catch (error) {
    logger.error('Failed to initialize email transporter:', error);
  }
}

/**
 * Get email template content
 */
function getEmailTemplate(template: EmailTemplate, data: Record<string, any>): { subject: string; html: string; text: string } {
  const baseUrl = config.server.frontendUrl;
  
  switch (template) {
    case 'welcome':
      return {
        subject: 'Bienvenue sur SafeSpot Sentinel Global',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #00E0FF, #00FF84); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">Bienvenue sur SafeSpot Sentinel Global</h1>
            </div>
            <div style="padding: 20px;">
              <p>Bonjour ${data.name},</p>
              <p>Bienvenue dans la communauté SafeSpot Sentinel Global ! Votre sécurité est notre priorité.</p>
              <p>Voici ce que vous pouvez faire maintenant :</p>
              <ul>
                <li>Configurer vos contacts d'urgence</li>
                <li>Activer la double authentification</li>
                <li>Explorer la carte des incidents en temps réel</li>
                <li>Découvrir les fonctionnalités Premium</li>
              </ul>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${baseUrl}/dashboard" style="background: #00E0FF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Accéder au tableau de bord</a>
              </div>
              <p>Ensemble, sécurisons le monde.</p>
              <p>L'équipe SafeSpot Sentinel Global</p>
            </div>
          </div>
        `,
        text: `Bienvenue sur SafeSpot Sentinel Global, ${data.name}! Accédez à votre tableau de bord: ${baseUrl}/dashboard`,
      };

    case 'sos_alert':
      return {
        subject: '🚨 ALERTE SOS URGENTE - SafeSpot Sentinel',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 3px solid #FF365F;">
            <div style="background: #FF365F; color: white; padding: 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px;">🚨 ALERTE SOS URGENTE</h1>
            </div>
            <div style="padding: 20px; background: #FFF5F5;">
              <p style="font-size: 18px; font-weight: bold; color: #FF365F;">
                ${data.userName} a déclenché une alerte SOS et a besoin d'aide immédiatement !
              </p>
              <div style="background: white; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Message:</strong> ${data.message}</p>
                <p><strong>Heure:</strong> ${new Date(data.timestamp).toLocaleString('fr-FR')}</p>
                <p><strong>Position:</strong> ${data.latitude}, ${data.longitude}</p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://maps.google.com/maps?q=${data.latitude},${data.longitude}" 
                   style="background: #FF365F; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                  📍 VOIR LA POSITION
                </a>
              </div>
              <div style="text-align: center; margin: 20px 0;">
                <a href="${baseUrl}/sos/${data.sessionId}" 
                   style="background: #00E0FF; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px;">
                  Suivre en temps réel
                </a>
              </div>
              <p><strong>Si c'est une urgence médicale ou criminelle, contactez immédiatement les services d'urgence :</strong></p>
              <p style="font-size: 20px; font-weight: bold; color: #FF365F;">📞 15 (SAMU) - 17 (Police) - 18 (Pompiers) - 112 (Urgences)</p>
            </div>
          </div>
        `,
        text: `ALERTE SOS URGENTE - ${data.userName} a besoin d'aide ! Position: ${data.latitude}, ${data.longitude}. Lien: https://maps.google.com/maps?q=${data.latitude},${data.longitude}`,
      };

    case 'email_verification':
      return {
        subject: 'Vérifiez votre adresse email - SafeSpot Sentinel',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #00E0FF, #00FF84); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">Vérification de votre email</h1>
            </div>
            <div style="padding: 20px;">
              <p>Bonjour,</p>
              <p>Veuillez cliquer sur le lien ci-dessous pour vérifier votre adresse email :</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${data.verificationUrl}" style="background: #00E0FF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Vérifier mon email</a>
              </div>
              <p>Ce lien expire dans 24 heures.</p>
              <p>Si vous n'avez pas créé de compte, ignorez cet email.</p>
            </div>
          </div>
        `,
        text: `Vérifiez votre email SafeSpot Sentinel: ${data.verificationUrl}`,
      };

    case 'password_reset':
      return {
        subject: 'Réinitialisation de votre mot de passe - SafeSpot Sentinel',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #00E0FF, #00FF84); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">Réinitialisation du mot de passe</h1>
            </div>
            <div style="padding: 20px;">
              <p>Bonjour,</p>
              <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${data.resetUrl}" style="background: #00E0FF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Réinitialiser mon mot de passe</a>
              </div>
              <p>Ce lien expire dans 1 heure.</p>
              <p>Si vous n'avez pas fait cette demande, ignorez cet email.</p>
            </div>
          </div>
        `,
        text: `Réinitialisez votre mot de passe SafeSpot Sentinel: ${data.resetUrl}`,
      };

    case '2fa_backup_codes':
      return {
        subject: '🔐 Nouveaux codes de sauvegarde 2FA - SafeSpot Sentinel',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #00E0FF, #00FF84); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">🔐 Codes de sauvegarde 2FA</h1>
            </div>
            <div style="padding: 20px;">
              <p>Bonjour ${data.name},</p>
              <p>Voici vos nouveaux codes de sauvegarde pour la double authentification :</p>
              <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; font-family: monospace;">
                ${data.backupCodes.map((code: string) => `<div style="margin: 5px 0;">${code}</div>`).join('')}
              </div>
              <p><strong>Important :</strong></p>
              <ul>
                <li>Conservez ces codes dans un endroit sûr</li>
                <li>Chaque code ne peut être utilisé qu'une seule fois</li>
                <li>Ces codes remplacent les précédents</li>
              </ul>
            </div>
          </div>
        `,
        text: `Nouveaux codes de sauvegarde 2FA SafeSpot Sentinel: ${data.backupCodes.join(', ')}`,
      };

    case 'premium_welcome':
      return {
        subject: '⭐ Bienvenue dans SafeSpot Sentinel Premium !',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #FFD700, #FFA500); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">⭐ Bienvenue dans Premium !</h1>
            </div>
            <div style="padding: 20px;">
              <p>Félicitations ${data.name} !</p>
              <p>Votre abonnement Premium est maintenant actif. Profitez de toutes les fonctionnalités avancées :</p>
              <ul>
                <li>✅ SOS contacts illimités</li>
                <li>✅ Rayon d'alerte étendu (20km)</li>
                <li>✅ Notifications prioritaires</li>
                <li>✅ Upload médias illimités</li>
                <li>✅ Mode escorte avancé</li>
                <li>✅ Support prioritaire</li>
              </ul>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${baseUrl}/dashboard" style="background: #FFD700; color: #333; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Découvrir Premium</a>
              </div>
            </div>
          </div>
        `,
        text: `Bienvenue dans SafeSpot Sentinel Premium, ${data.name}! Découvrez toutes les fonctionnalités: ${baseUrl}/dashboard`,
      };

    case 'security_alert':
      return {
        subject: '🚨 Alerte de sécurité - SafeSpot Sentinel',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #FF365F; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">🚨 Alerte de sécurité</h1>
            </div>
            <div style="padding: 20px;">
              <p>Bonjour,</p>
              <p>Nous avons détecté une activité inhabituelle sur votre compte :</p>
              <div style="background: #FFF5F5; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Type:</strong> ${data.alertType}</p>
                <p><strong>Date:</strong> ${new Date(data.timestamp).toLocaleString('fr-FR')}</p>
                <p><strong>Détails:</strong> ${data.details}</p>
              </div>
              <p>Si ce n'était pas vous, sécurisez immédiatement votre compte :</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${baseUrl}/security" style="background: #FF365F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Sécuriser mon compte</a>
              </div>
            </div>
          </div>
        `,
        text: `Alerte de sécurité SafeSpot Sentinel: ${data.alertType}. Sécurisez votre compte: ${baseUrl}/security`,
      };

    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}

/**
 * Send email with template
 */
export async function sendEmail(emailData: EmailData): Promise<EmailResult> {
  if (!transporter) {
    logger.warn('Email not configured, using mock mode');
    logger.info('📧 Mock email sent', { 
      to: emailData.to, 
      template: emailData.template,
      priority: emailData.priority 
    });
    return { success: true, messageId: `mock_${Date.now()}` };
  }

  try {
    // Rate limiting (except for emergency emails)
    if (emailData.priority !== 'emergency') {
      const rateLimit = await checkRateLimit(
        `email:${emailData.to}`,
        emailData.priority === 'high' ? 20 : 10, // High priority: 20/hour, normal: 10/hour
        3600000, // 1 hour
        'email_rate_limit'
      );

      if (!rateLimit.allowed) {
        throw new Error('Email rate limit exceeded');
      }
    }

    // Get template content
    const template = getEmailTemplate(emailData.template, emailData.data);

    // Send email
    const result = await transporter.sendMail({
      from: config.integrations.email.from,
      to: emailData.to,
      subject: template.subject,
      text: template.text,
      html: template.html,
      priority: emailData.priority === 'emergency' ? 'high' : 'normal',
    });

    logger.info('Email sent successfully', {
      to: emailData.to,
      template: emailData.template,
      messageId: result.messageId,
      priority: emailData.priority,
    });

    return { success: true, messageId: result.messageId };

  } catch (error: any) {
    logger.error('Email sending failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send SOS alert email to emergency contacts
 */
export async function sendSOSAlertEmail(
  contactEmail: string,
  userName: string,
  message: string,
  location: { latitude: number; longitude: number },
  sessionId: string
): Promise<EmailResult> {
  return sendEmail({
    to: contactEmail,
    template: 'sos_alert',
    priority: 'emergency',
    data: {
      userName,
      message,
      latitude: location.latitude,
      longitude: location.longitude,
      sessionId,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Send welcome email to new users
 */
export async function sendWelcomeEmail(email: string, name: string): Promise<EmailResult> {
  return sendEmail({
    to: email,
    template: 'welcome',
    priority: 'normal',
    data: { name },
  });
}

/**
 * Send email verification
 */
export async function sendEmailVerification(email: string, verificationUrl: string): Promise<EmailResult> {
  return sendEmail({
    to: email,
    template: 'email_verification',
    priority: 'high',
    data: { verificationUrl },
  });
}

/**
 * Send password reset email
 */
export async function sendPasswordReset(email: string, resetUrl: string): Promise<EmailResult> {
  return sendEmail({
    to: email,
    template: 'password_reset',
    priority: 'high',
    data: { resetUrl },
  });
}

/**
 * Send 2FA backup codes
 */
export async function send2FABackupCodes(email: string, name: string, backupCodes: string[]): Promise<EmailResult> {
  return sendEmail({
    to: email,
    template: '2fa_backup_codes',
    priority: 'high',
    data: { name, backupCodes },
  });
}

/**
 * Send premium welcome email
 */
export async function sendPremiumWelcomeEmail(email: string, name: string): Promise<EmailResult> {
  return sendEmail({
    to: email,
    template: 'premium_welcome',
    priority: 'normal',
    data: { name },
  });
}

/**
 * Send security alert email
 */
export async function sendSecurityAlert(
  email: string,
  alertType: string,
  details: string
): Promise<EmailResult> {
  return sendEmail({
    to: email,
    template: 'security_alert',
    priority: 'high',
    data: {
      alertType,
      details,
      timestamp: new Date().toISOString(),
    },
  });
}