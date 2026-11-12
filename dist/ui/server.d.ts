import { AppConfig } from '../config/types';
import { AppScheduler } from '../scheduler/scheduler';
import { ExportOrchestrator } from '../scheduler/orchestrator';
import { StateManager } from '../scheduler/stateManager';
export declare class WebUiServer {
    private config;
    private scheduler;
    private orchestrator;
    private stateManager;
    private onConfigUpdate;
    private app;
    private server;
    private host;
    private port;
    constructor(config: AppConfig, scheduler: AppScheduler, orchestrator: ExportOrchestrator, stateManager: StateManager, onConfigUpdate: (newConfig: AppConfig) => void);
    private setupRoutes;
    start(): Promise<void>;
    stop(): Promise<void>;
}
