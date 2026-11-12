"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailerService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_1 = require("../config/config");
const templates_1 = require("./templates");
const zip_1 = require("../utils/zip");
const logger_1 = require("../utils/logger");
class MailerService {
    config;
    transporter = null;
    constructor(config) {
        this.config = config;
        this.initTransporter(config);
    }
    initTransporter(config) {
        const password = (0, config_1.getDecryptedSmtpPassword)(config);
        this.transporter = nodemailer_1.default.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure, // true for 465, false for other ports
            auth: config.smtp.user ? {
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
    async verifyConnection() {
        if (!this.transporter) {
            return { success: false, message: 'Mailer transporter not initialized' };
        }
        try {
            await this.transporter.verify();
            return { success: true, message: 'SMTP server connection and credentials verified successfully!' };
        }
        catch (err) {
            logger_1.logger.error(`SMTP verification failed: ${err.message}`);
            return { success: false, message: `SMTP verification failed: ${err.message}` };
        }
    }
    /**
     * Sends export report email with attachments, with 3x retry and exponential backoff
     */
    async sendDayBookEmail(options) {
        const { summary, config, date = new Date() } = options;
        const successfulResults = summary.results.filter((r) => r.status === 'OK' && r.fileBuffer);
        // If ALL companies failed, send alert mail instead
        if (summary.totalCompanies > 0 && successfulResults.length === 0) {
            logger_1.logger.warn('All companies failed in this export cycle. Dispatching alert email...');
            const failureDetails = summary.results
                .map((r) => `${r.companyName}: ${r.error || r.status}`)
                .join('\n');
            return this.sendAlert('Export Failure Alert - All Companies Failed', 'None of the open TallyPrime companies could be exported in this cycle.', failureDetails);
        }
        // Build attachments
        const attachments = [];
        if (config.attachMode === 'zip') {
            const filesToZip = successfulResults.map((r) => ({
                filename: r.fileName || `${r.companyName}_DayBook.xlsx`,
                buffer: r.fileBuffer,
            }));
            if (filesToZip.length > 0) {
                try {
                    const zipBuffer = await (0, zip_1.createZipBuffer)(filesToZip);
                    const pad = (n) => n.toString().padStart(2, '0');
                    const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
                    attachments.push({
                        filename: `Tally_DayBooks_${timestamp}.zip`,
                        content: zipBuffer,
                    });
                }
                catch (zipErr) {
                    logger_1.logger.error(`Failed to create ZIP attachment: ${zipErr.message}. Falling back to separate files.`);
                    for (const r of successfulResults) {
                        attachments.push({
                            filename: r.fileName || `${r.companyName}_DayBook.xlsx`,
                            content: r.fileBuffer,
                        });
                    }
                }
            }
        }
        else {
            // Separate files
            for (const r of successfulResults) {
                attachments.push({
                    filename: r.fileName || `${r.companyName}_DayBook.xlsx`,
                    content: r.fileBuffer,
                });
            }
        }
        const subject = (0, templates_1.buildSubject)(config.mail.subjectTemplate, summary.totalCompanies, date);
        const html = (0, templates_1.buildExportEmailHtml)(summary, config.dayBook.periodMode);
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
    async sendAlert(title, message, details) {
        const html = (0, templates_1.buildAlertEmailHtml)(title, message, details);
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
    async sendWithRetry(mailOptions, maxRetries = 3) {
        if (!this.transporter) {
            logger_1.logger.error('Transporter not initialized. Cannot send email.');
            return false;
        }
        let attempt = 0;
        let delay = 2000; // start 2 seconds
        while (attempt < maxRetries) {
            attempt++;
            try {
                logger_1.logger.info(`Sending email (attempt ${attempt}/${maxRetries}) to: ${JSON.stringify(mailOptions.to)}`);
                const info = await this.transporter.sendMail(mailOptions);
                logger_1.logger.info(`Email successfully dispatched! Message ID: ${info.messageId}`);
                return true;
            }
            catch (err) {
                logger_1.logger.error(`Email send attempt ${attempt} failed: ${err.message}`);
                if (attempt < maxRetries) {
                    logger_1.logger.info(`Waiting ${delay}ms before next retry...`);
                    await new Promise((res) => setTimeout(res, delay));
                    delay *= 2; // exponential backoff: 2s, 4s, 8s
                }
            }
        }
        logger_1.logger.error(`All ${maxRetries} email send attempts failed.`);
        return false;
    }
}
exports.MailerService = MailerService;
//# sourceMappingURL=mailer.js.map