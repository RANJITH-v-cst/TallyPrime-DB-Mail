import http from 'http';
export declare const MOCK_COMPANIES: string[];
export declare function startMockTallyServer(port?: number, mode?: 'native' | 'fallback_xml' | 'mixed'): Promise<http.Server>;
