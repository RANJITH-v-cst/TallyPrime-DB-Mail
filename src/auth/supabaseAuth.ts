import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { getDataDir } from '../utils/appPaths';
import { logger } from '../utils/logger';
import { loadEnv } from '../utils/env';

loadEnv();

const DEFAULT_SUPABASE_URL = 'https://crdyotqtshmplxfqeerh.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNyZHlvdHF0c2htcGx4ZnFlZXJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3OTg1ODksImV4cCI6MjExMDM3NDU4OX0.Q3pFsSIfW_UGmMJW99epOnfxy810cIAQd_15rYBDA8Y';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  user: AuthUser;
}

export class SupabaseAuthService {
  private supabaseUrl: string;
  private anonKey: string;
  private currentSession: AuthSession | null = null;
  private sessionFilePath: string;

  constructor() {
    this.supabaseUrl = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
    this.anonKey = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
    this.sessionFilePath = path.join(getDataDir(), 'auth_session.json');
    this.loadSavedSession();
  }

  private getHeaders(token?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.anonKey,
      Authorization: `Bearer ${token || this.anonKey}`,
    };
  }

  private loadSavedSession(): void {
    try {
      if (fs.existsSync(this.sessionFilePath)) {
        const raw = fs.readFileSync(this.sessionFilePath, 'utf8');
        const session = JSON.parse(raw) as AuthSession;
        if (session && session.accessToken && session.user?.email) {
          this.currentSession = session;
          logger.info(`[Auth] Restored active session for user: ${session.user.email}`);
        }
      }
    } catch (e: any) {
      logger.warn(`[Auth] Could not load saved session: ${e.message}`);
      this.currentSession = null;
    }
  }

  private persistSession(session: AuthSession | null): void {
    try {
      if (session) {
        fs.writeFileSync(this.sessionFilePath, JSON.stringify(session, null, 2), 'utf8');
      } else {
        if (fs.existsSync(this.sessionFilePath)) {
          fs.unlinkSync(this.sessionFilePath);
        }
      }
    } catch (e: any) {
      logger.warn(`[Auth] Could not persist session: ${e.message}`);
    }
  }

  public isAuthenticated(): boolean {
    return !!this.currentSession?.accessToken;
  }

  public getCurrentUser(): AuthUser | null {
    return this.currentSession ? this.currentSession.user : null;
  }

  public getSession(): AuthSession | null {
    return this.currentSession;
  }

  /**
   * Signs in a user with Email and Password using Supabase Auth REST API
   */
  public async signIn(email: string, password: string): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
    try {
      const endpoint = `${this.supabaseUrl}/auth/v1/token?grant_type=password`;
      const res = await axios.post(
        endpoint,
        { email: email.trim(), password },
        { headers: this.getHeaders(), timeout: 15000 }
      );

      const data = res.data;
      if (!data.access_token || !data.user) {
        return { success: false, error: 'Invalid response from authentication server.' };
      }

      this.currentSession = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at ? data.expires_at * 1000 : undefined,
        user: {
          id: data.user.id,
          email: data.user.email,
        },
      };

      this.persistSession(this.currentSession);
      logger.info(`[Auth] User signed in successfully: ${this.currentSession.user.email}`);
      return { success: true, user: this.currentSession.user };
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.error_description ||
        err.response?.data?.msg ||
        err.response?.data?.message ||
        err.message ||
        'Authentication failed';
      logger.error(`[Auth] Sign in failed for ${email}: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Signs up a new user with Email and Password
   */
  public async signUp(email: string, password: string): Promise<{ success: boolean; user?: AuthUser; message?: string; error?: string }> {
    try {
      const endpoint = `${this.supabaseUrl}/auth/v1/signup`;
      const res = await axios.post(
        endpoint,
        { email: email.trim(), password },
        { headers: this.getHeaders(), timeout: 15000 }
      );

      const data = res.data;
      const user = data.user || data;

      // In Supabase, if email confirmation is disabled, session / access_token is returned immediately
      if (data.access_token && user) {
        this.currentSession = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_at ? data.expires_at * 1000 : undefined,
          user: {
            id: user.id,
            email: user.email,
          },
        };
        this.persistSession(this.currentSession);
        return { success: true, user: this.currentSession.user, message: 'Account created and signed in successfully!' };
      }

      return {
        success: true,
        user: { id: user.id, email: user.email },
        message: 'Account created! Please check your email to confirm registration or sign in.',
      };
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.error_description ||
        err.response?.data?.msg ||
        err.response?.data?.message ||
        err.message ||
        'Sign up failed';
      logger.error(`[Auth] Sign up failed for ${email}: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Signs out the current user and clears local session
   */
  public async signOut(): Promise<void> {
    const userEmail = this.currentSession?.user?.email;
    if (this.currentSession?.accessToken) {
      try {
        await axios.post(
          `${this.supabaseUrl}/auth/v1/logout`,
          {},
          { headers: this.getHeaders(this.currentSession.accessToken), timeout: 5000 }
        );
      } catch {
        // ignore network error on logout
      }
    }
    this.currentSession = null;
    this.persistSession(null);
    if (userEmail) {
      logger.info(`[Auth] User signed out: ${userEmail}`);
    }
  }

  /**
   * Validates active session against Supabase user endpoint
   */
  public async validateSession(): Promise<boolean> {
    if (!this.currentSession?.accessToken) return false;
    try {
      const endpoint = `${this.supabaseUrl}/auth/v1/user`;
      const res = await axios.get(endpoint, {
        headers: this.getHeaders(this.currentSession.accessToken),
        timeout: 10000,
      });
      if (res.data?.id) {
        this.currentSession.user.id = res.data.id;
        this.currentSession.user.email = res.data.email;
        return true;
      }
      return false;
    } catch {
      // If token expired or revoked, clear session
      this.currentSession = null;
      this.persistSession(null);
      return false;
    }
  }
}
