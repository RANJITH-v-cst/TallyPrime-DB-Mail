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
exports.StateManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
class StateManager {
    stateFilePath;
    state;
    constructor(filePath) {
        this.stateFilePath = filePath || path.resolve(process.cwd(), 'state.json');
        this.state = this.loadState();
    }
    /**
     * Loads state from file or initializes default empty state
     */
    loadState() {
        if (!fs.existsSync(this.stateFilePath)) {
            const initial = { companies: {} };
            this.state = initial;
            this.saveState();
            return initial;
        }
        try {
            const content = fs.readFileSync(this.stateFilePath, 'utf8');
            const parsed = JSON.parse(content);
            this.state = {
                companies: parsed.companies || {},
                lastCycleTimestamp: parsed.lastCycleTimestamp,
                lastTallyDownAlertTimestamp: parsed.lastTallyDownAlertTimestamp,
            };
            return this.state;
        }
        catch (err) {
            logger_1.logger.warn(`Failed to read state.json: ${err.message}. Initializing empty state.`);
            this.state = { companies: {} };
            return this.state;
        }
    }
    /**
     * Atomically writes state to state.json using write-then-rename
     */
    saveState() {
        try {
            const dir = path.dirname(this.stateFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const tempFile = `${this.stateFilePath}.${Date.now()}.tmp`;
            const json = JSON.stringify(this.state, null, 2);
            fs.writeFileSync(tempFile, json, 'utf8');
            fs.renameSync(tempFile, this.stateFilePath);
        }
        catch (err) {
            logger_1.logger.error(`Error atomically saving state.json: ${err.message}`);
        }
    }
    /**
     * Retrieves state for a given company
     */
    getCompanyState(companyName) {
        return this.state.companies[companyName] || {};
    }
    /**
     * Updates state for a given company and saves atomically
     */
    updateCompanyState(companyName, update) {
        const current = this.state.companies[companyName] || {};
        this.state.companies[companyName] = {
            ...current,
            ...update,
        };
        this.saveState();
    }
    /**
     * Checks if date has rolled over to a new day since last run
     */
    isMidnightRollover(companyName, todayStr) {
        const compState = this.getCompanyState(companyName);
        if (!compState.lastDate)
            return false;
        return compState.lastDate !== todayStr;
    }
    /**
     * Records last full cycle timestamp
     */
    setLastCycleTime(isoTime = new Date().toISOString()) {
        this.state.lastCycleTimestamp = isoTime;
        this.saveState();
    }
    getLastCycleTime() {
        return this.state.lastCycleTimestamp;
    }
    /**
     * Determines if a Tally-down alert mail can be sent (throttled to at most once per hour)
     */
    shouldSendTallyDownAlert() {
        if (!this.state.lastTallyDownAlertTimestamp)
            return true;
        const lastAlert = new Date(this.state.lastTallyDownAlertTimestamp).getTime();
        const now = Date.now();
        const oneHourMs = 60 * 60 * 1000;
        return now - lastAlert >= oneHourMs;
    }
    /**
     * Records timestamp when Tally-down alert was sent
     */
    recordTallyDownAlertSent() {
        this.state.lastTallyDownAlertTimestamp = new Date().toISOString();
        this.saveState();
    }
    /**
     * Clears Tally-down alert timestamp once Tally is back online
     */
    clearTallyDownAlert() {
        if (this.state.lastTallyDownAlertTimestamp) {
            delete this.state.lastTallyDownAlertTimestamp;
            this.saveState();
        }
    }
    getRawState() {
        return this.state;
    }
}
exports.StateManager = StateManager;
//# sourceMappingURL=stateManager.js.map