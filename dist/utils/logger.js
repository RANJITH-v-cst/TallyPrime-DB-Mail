"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston = __importStar(require("winston"));
require("winston-daily-rotate-file");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    try {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    catch {
        // ignore
    }
}
// Custom format to mask sensitive data like passwords, tokens
const redactFormat = winston.format((info) => {
    const sensitiveKeys = ['password', 'pass', 'auth', 'secret', 'token', 'credentials'];
    const redactObject = (obj) => {
        if (!obj || typeof obj !== 'object')
            return obj;
        if (Array.isArray(obj))
            return obj.map(redactObject);
        const result = {};
        for (const key of Object.keys(obj)) {
            if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
                result[key] = '********';
            }
            else if (typeof obj[key] === 'object') {
                result[key] = redactObject(obj[key]);
            }
            else {
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
const fileRotateTransport = new winston.transports.DailyRotateFile({
    filename: path.join(logsDir, 'tally-daybook-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d', // Keep for 30 days
    level: 'info',
});
const errorFileRotateTransport = new winston.transports.DailyRotateFile({
    filename: path.join(logsDir, 'tally-daybook-error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error',
});
exports.logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(redactFormat(), winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.errors({ stack: true }), winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        const stackStr = stack ? `\n${stack}` : '';
        return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}${stackStr}`;
    })),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
                const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                const stackStr = stack ? `\n${stack}` : '';
                return `[${timestamp}] [${level}] ${message}${metaStr}${stackStr}`;
            })),
        }),
        fileRotateTransport,
        errorFileRotateTransport,
    ],
});
//# sourceMappingURL=logger.js.map