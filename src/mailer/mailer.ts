import nodemailer, { Transporter } from 'nodemailer';
import { AppConfig, CompanyExportResult, ExportCycleSummary } from '../config/types';
import { getDecryptedSmtpPassword } from '../config/config';
import { buildSubject, buildExportEmailHtml, buildAlertEmailHtml } from './templates';
import { createZipBuffer } from '../utils/zip';
import { logger } from '../utils/logger';

export interface SendEmailOptions {
  summary: ExportCycleSummary;
  config: AppConfig;
  date?: Date;
}

export class MailerService {
  private transporter: Transporter | null = null;

  constructor(private config: AppConfig) {
    this.initTransporter(config);
  }

  public initTransporter(config: AppConfig): void {
    const rawPassword = getDecryptedSmtpPassword(config);
    // Strip whitespace from passwords (e.g. Gmail 16-character app passwords like "abcd efgh ijkl mnop")
    const password = rawPassword ? rawPassword.replace(/\s+/g, '') : '';

    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure, // true for 465, false for other ports
      auth: (config.smtp.user && password) ? {
        user: config.smtp.user,
        pass: password,
      } : undefined,
      tls: {
        rejectUnauthorized: false, // Prevents self-signed cert blocks on internal corporate relays
      },
    });
  }

  /**
   * Verifies SMTP connection and authentication credentials
   */
  public async verifyConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.transporter) {
      return { success: false, message: 'Mailer transporter not initialized' };
    }
    const rawPassword = getDecryptedSmtpPassword(this.config);
    if (this.config.smtp.user && !rawPassword) {
      return {
        success: false,
        message: 'SMTP Password is missing. Please enter your App Password in Settings.',
      };
    }
    try {
      await this.transporter.verify();
      return { success: true, message: 'SMTP server connection and credentials verified successfully!' };
    } catch (err: any) {
      logger.error(`SMTP verification failed: ${err.message}`);
      return { success: false, message: `SMTP verification failed: ${err.message}` };
    }
  }

  /**
   * Sends a real test email to the given recipient list, reporting exact SMTP error text on failure.
   */
  public async sendTestEmail(toRecipients: string[]): Promise<{ success: boolean; message: string }> {
    if (!this.transporter) {
      return { success: false, message: 'SMTP Transporter not initialized.' };
    }
    const rawPassword = getDecryptedSmtpPassword(this.config);
    if (this.config.smtp.user && !rawPassword) {
      return {
        success: false,
        message: 'SMTP Password is missing. Please enter your App Password in Settings.',
      };
    }

    try {
      await this.transporter.verify();

      const toCount = toRecipients.length;
      logger.info(`Sending test email to ${toCount} recipient(s)...`);

      const info = await this.transporter.sendMail({
        from: this.config.smtp.from || this.config.smtp.user,
        to: toRecipients,
        subject: `[TEST] TallyDayBookMailer SMTP Test (${new Date().toLocaleTimeString()})`,
        text: 'This is a test email sent from TallyDayBookMailer to verify SMTP connectivity and recipient routing.',
        html: `
          <div style="font-family: sans-serif; padding: 20px; background: #f8fafc; border-radius: 8px;">
            <h2 style="color: #1e40af; margin-top: 0;">✅ SMTP Test Successful!</h2>
            <p>This test email confirms that <strong>TallyDayBookMailer</strong> can successfully authenticate with your SMTP server and deliver messages.</p>
            <p style="font-size: 12px; color: #64748b;">Timestamp: ${new Date().toISOString()}</p>
          </div>
        `,
      });

      logger.info(`Test email sent successfully to ${toCount} recipient(s). Message ID: ${info.messageId}`);
      return {
        success: true,
        message: `Test email sent successfully to ${toCount} recipient(s)! (Message ID: ${info.messageId})`,
      };
    } catch (err: any) {
      const errDetails = `${err.message}${err.code ? ` [Code: ${err.code}]` : ''}${err.response ? ` - ${err.response}` : ''}`;
      logger.error(`SMTP Test failed: ${errDetails}`);
      return {
        success: false,
        message: `SMTP Test failed: ${errDetails}`,
      };
    }
  }

  /**
   * Sends export report email with attachments, with 3x retry and exponential backoff
   */
  public async sendDayBookEmail(options: SendEmailOptions): Promise<boolean> {
    const { summary, config, date = new Date() } = options;
    const successfulResults = summary.results.filter((r) => r.status === 'OK' && r.fileBuffer);

    // If ALL companies failed, send alert mail instead
    if (summary.totalCompanies > 0 && successfulResults.length === 0) {
      logger.warn('All companies failed in this export cycle. Dispatching alert email...');
      const failureDetails = summary.results
        .map((r) => `${r.companyName}: ${r.error || r.status}`)
        .join('\n');
      return this.sendAlert(
        'Export Failure Alert - All Companies Failed',
        'None of the open TallyPrime companies could be exported in this cycle.',
        failureDetails
      );
    }

    // Build attachments
    const attachments: { filename: string; content: Buffer }[] = [];

    if (config.attachMode === 'zip') {
      const filesToZip = successfulResults.map((r) => ({
        filename: r.fileName || `${r.companyName}_DayBook.xlsx`,
        buffer: r.fileBuffer!,
      }));

      if (filesToZip.length > 0) {
        try {
          const zipBuffer = await createZipBuffer(filesToZip);
          const pad = (n: number) => n.toString().padStart(2, '0');
          const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
          attachments.push({
            filename: `Tally_DayBooks_${timestamp}.zip`,
            content: zipBuffer,
          });
        } catch (zipErr: any) {
          logger.error(`Failed to create ZIP attachment: ${zipErr.message}. Falling back to separate files.`);
          for (const r of successfulResults) {
            attachments.push({
              filename: r.fileName || `${r.companyName}_DayBook.xlsx`,
              content: r.fileBuffer!,
            });
          }
        }
      }
    } else {
      // Separate files
      for (const r of successfulResults) {
        attachments.push({
          filename: r.fileName || `${r.companyName}_DayBook.xlsx`,
          content: r.fileBuffer!,
        });
      }
    }

    const samplePeriod = summary.results.find((r) => r.periodText && r.periodText !== '--')?.periodText;
    const subject = buildSubject(config.mail.subjectTemplate, summary.totalCompanies, date, samplePeriod);
    // Show the mode that was actually used (a Send Now date range overrides the saved period mode)
    const usedDateRange = summary.results.some((r) => r.periodText && r.periodText.includes(' to '));
    const html = buildExportEmailHtml(summary, usedDateRange ? 'customRange' : config.dayBook.periodMode);

    return this.sendWithRetry({
      from: config.smtp.from || config.smtp.user,
      to: config.mail.recipients.to,
      cc: config.mail.recipients.cc,
      bcc: config.mail.recipients.bcc,
      subject,
      html,
      attachments,
    });
  }

  /**
   * Sends an alert email (e.g. TallyPrime down or total failure)
   */
  public async sendAlert(title: string, message: string, details?: string): Promise<boolean> {
    const html = buildAlertEmailHtml(title, message, details);
    return this.sendWithRetry({
      from: this.config.smtp.from || this.config.smtp.user,
      to: this.config.mail.recipients.to,
      cc: this.config.mail.recipients.cc,
      bcc: this.config.mail.recipients.bcc,
      subject: `[ALERT] ${title}`,
      html,
    });
  }

  /**
   * Helper to send an email with 3 retries and exponential backoff
   */
  private async sendWithRetry(mailOptions: nodemailer.SendMailOptions, maxRetries = 3): Promise<boolean> {
    if (!this.transporter) {
      logger.error('Transporter not initialized. Cannot send email.');
      return false;
    }

    let attempt = 0;
    let delay = 2000; // start 2 seconds

    const toCount = Array.isArray(mailOptions.to) ? mailOptions.to.length : (mailOptions.to ? 1 : 0);
    const ccCount = Array.isArray(mailOptions.cc) ? mailOptions.cc.length : (mailOptions.cc ? 1 : 0);
    const bccCount = Array.isArray(mailOptions.bcc) ? mailOptions.bcc.length : (mailOptions.bcc ? 1 : 0);

    while (attempt < maxRetries) {
      attempt++;
      try {
        logger.info(`Sending email (attempt ${attempt}/${maxRetries}) to ${toCount} recipient(s) (CC: ${ccCount}, BCC: ${bccCount})`);
        const info = await this.transporter.sendMail(mailOptions);
        logger.info(`Email successfully dispatched! Message ID: ${info.messageId}`);
        return true;
      } catch (err: any) {
        logger.error(`Email send attempt ${attempt} failed: ${err.message}`);
        if (attempt < maxRetries) {
          logger.info(`Waiting ${delay}ms before next retry...`);
          await new Promise((res) => setTimeout(res, delay));
          delay *= 2; // exponential backoff: 2s, 4s, 8s
        }
      }
    }

    logger.error(`All ${maxRetries} email send attempts failed.`);
    return false;
  }
}

