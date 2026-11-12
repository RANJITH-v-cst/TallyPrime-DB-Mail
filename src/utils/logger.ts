import * as winston from 'winston';
import 'winston-daily-rotate-file';
import * as path from 'path';
import * as fs from 'fs';

const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch {
    // ignore
  }
}

// Custom format to mask sensitive data like passwords, tokens
const redactFormat = winston.format((info) => {
  const sensitiveKeys = ['password', 'pass', 'auth', 'secret', 'token', 'credentials'];

  const redactObject = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(redactObject);

    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
        result[key] = '********';
      } else if (typeof obj[key] === 'object') {
        result[key] = redactObject(obj[key]);
      } else {
        result[key] = obj[key];
      }
    }
    return result;
  };

  if (typeof info.message === 'string') {
    // Replace password="xyz" or password: "xyz"
    info.message = info.message.replace(/(password['"]?\s*[:=]\s*['"])([^'"]+)(['"])/gi, '$1********$3');
  }

  return redactObject(info);
});

const fileRotateTransport = new (winston.transports as any).DailyRotateFile({
  filename: path.join(logsDir, 'tally-daybook-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '30d', // Keep for 30 days
  level: 'info',
});

const errorFileRotateTransport = new (winston.transports as any).DailyRotateFile({
  filename: path.join(logsDir, 'tally-daybook-error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    redactFormat(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      const stackStr = stack ? `\n${stack}` : '';
      return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}${stackStr}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          const stackStr = stack ? `\n${stack}` : '';
          return `[${timestamp}] [${level}] ${message}${metaStr}${stackStr}`;
        })
      ),
    }),
    fileRotateTransport,
    errorFileRotateTransport,
  ],
});

