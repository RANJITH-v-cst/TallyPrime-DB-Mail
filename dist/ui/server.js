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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebUiServer = void 0;
const express_1 = __importDefault(require("express"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
class WebUiServer {
    config;
    scheduler;
    orchestrator;
    stateManager;
    onConfigUpdate;
    app;
    server = null;
    host;
    port;
    constructor(config, scheduler, orchestrator, stateManager, onConfigUpdate) {
        this.config = config;
        this.scheduler = scheduler;
        this.orchestrator = orchestrator;
        this.stateManager = stateManager;
        this.onConfigUpdate = onConfigUpdate;
        this.app = (0, express_1.default)();
        this.host = '127.0.0.1'; // Strictly localhost only
        this.port = config.webUi?.port || 9095;
        this.setupRoutes();
    }
    setupRoutes() {
        this.app.use(express_1.default.json());
        this.app.use(express_1.default.urlencoded({ extended: true }));
        // Serve static files from public/ (works in both dev ts-node and compiled dist)
        let publicDir = path.resolve(__dirname, 'public');
        if (!fs.existsSync(publicDir)) {
            const srcPublic = path.resolve(process.cwd(), 'src', 'ui', 'public');
            if (fs.existsSync(srcPublic)) {
                publicDir = srcPublic;
            }
        }
        this.app.use(express_1.default.static(publicDir));
        // API: Current Status
        this.app.get('/api/status', (req, res) => {
            const isRunning = this.orchestrator.getIsRunning();
            const lastSummary = this.scheduler.getLastSummary();
            const nextRun = this.scheduler.getNextRunDate();
            const rawState = this.stateManager.getRawState();
            res.json({
                isRunning,
                lastSummary,
                nextRun: nextRun ? nextRun.toISOString() : null,
                companyStates: rawState.companies,
                lastCycleTimestamp: rawState.lastCycleTimestamp,
                tallyConfig: {
                    host: this.config.tally.host,
                    port: this.config.tally.port,
                },
                intervalMinutes: this.config.schedule.intervalMinutes,
            });
        });
        // API: Get Config (with password masked)
        this.app.get('/api/config', (req, res) => {
            const cfg = JSON.parse(JSON.stringify(this.config));
            // Mask password for UI
            if (cfg.smtp.password) {
                cfg.smtp.password = '********';
            }
            res.json(cfg);
        });
        // API: Save Config
        this.app.post('/api/config', (req, res) => {
            try {
                const incoming = req.body;
                // If password was left masked, retain previous encrypted password
                if (incoming.smtp.password === '********') {
                    incoming.smtp.password = this.config.smtp.password;
                }
                const validation = (0, config_1.validateConfig)(incoming);
                if (!validation.valid) {
                    return res.status(400).json({ success: false, errors: validation.errors });
                }
                (0, config_1.saveConfig)(incoming);
                this.config = incoming;
                this.onConfigUpdate(incoming);
                logger_1.logger.info('Configuration updated via Web UI.');
                res.json({ success: true, message: 'Settings saved and applied successfully!' });
            }
            catch (err) {
                logger_1.logger.error(`Error saving config from UI: ${err.message}`);
                res.status(500).json({ success: false, error: err.message });
            }
        });
        // API: Trigger "Send Now" (Manual Run)
        this.app.post('/api/run-now', async (req, res) => {
            try {
                if (this.orchestrator.getIsRunning()) {
                    return res.status(409).json({ success: false, message: 'An export cycle is already running' });
                }
                // Run asynchronously so UI gets immediate feedback or wait
                this.scheduler.triggerManualRun()
                    .then((summary) => {
                    logger_1.logger.info('Manual run initiated from Web UI completed successfully.');
                })
                    .catch((err) => {
                    logger_1.logger.error(`Manual run from Web UI failed: ${err.message}`);
                });
                res.json({ success: true, message: 'Export cycle triggered! Monitor live progress in the Status tab.' });
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        // API: Test SMTP Connection
        this.app.post('/api/test-mail', async (req, res) => {
            try {
                const mailer = this.orchestrator.getMailer();
                const testRes = await mailer.verifyConnection();
                res.json(testRes);
            }
            catch (err) {
                res.status(500).json({ success: false, message: `SMTP check failed: ${err.message}` });
            }
        });
        // API: Test Tally Connection & Discover Companies
        this.app.get('/api/test-tally', async (req, res) => {
            try {
                const discovery = this.orchestrator.getDiscoveryService();
                const result = await discovery.discoverCompanies(this.config.companies);
                res.json({
                    success: true,
                    openCompanies: result.openCompanies,
                    missingCompanies: result.missingCompanies,
                    configuredCompanies: result.configuredCompanies,
                    isMatch: result.isMatch,
                });
            }
            catch (err) {
                res.status(500).json({
                    success: false,
                    error: `Could not connect to TallyPrime at ${this.config.tally.host}:${this.config.tally.port}: ${err.message}`,
                });
            }
        });
        // API: Read Recent Logs
        this.app.get('/api/logs', (req, res) => {
            try {
                const logsDir = path.resolve(process.cwd(), 'logs');
                if (!fs.existsSync(logsDir)) {
                    return res.json({ logs: [] });
                }
                const files = fs.readdirSync(logsDir)
                    .filter((f) => f.endsWith('.log') && !f.includes('error'))
                    .sort()
                    .reverse();
                if (files.length === 0) {
                    return res.json({ logs: ['No logs generated yet.'] });
                }
                const latestLog = path.join(logsDir, files[0]);
                const content = fs.readFileSync(latestLog, 'utf8');
                const lines = content.split('\n').filter((l) => l.trim().length > 0);
                const last100 = lines.slice(-100);
                res.json({ logs: last100 });
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
        // Fallback to index.html
        this.app.get('*', (req, res) => {
            res.sendFile(path.resolve(publicDir, 'index.html'));
        });
    }
    start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.port, this.host, () => {
                    logger_1.logger.info(`Web UI is running securely at http://${this.host}:${this.port}`);
                    resolve();
                });
                this.server.on('error', (err) => {
                    logger_1.logger.error(`Failed to start Web UI server: ${err.message}`);
                    reject(err);
                });
            }
            catch (err) {
                reject(err);
            }
        });
    }
    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    logger_1.logger.info('Web UI server stopped.');
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    }
}
exports.WebUiServer = WebUiServer;
//# sourceMappingURL=server.js.map