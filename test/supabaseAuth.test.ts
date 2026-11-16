import { SupabaseAuthService } from '../src/auth/supabaseAuth';

describe('Supabase Authentication Service Tests', () => {
  let authService: SupabaseAuthService;

  beforeEach(() => {
    authService = new SupabaseAuthService();
  });

  test('1. Default authentication state is unauthenticated when no session file exists', () => {
    // If not logged in, isAuthenticated should return false
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getCurrentUser()).toBeNull();
  });

  test('2. Sign in with invalid credentials returns success=false and an error message', async () => {
    const result = await authService.signIn('nonexistent_user_xyz@advent.com', 'wrongpassword123');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });

  test('3. Sign up with short password returns error', async () => {
    const result = await authService.signUp('test@advent.com', '123');
    expect(result.success).toBe(false);
  });

  test('4. Sign out clears active session and user', async () => {
    await authService.signOut();
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getCurrentUser()).toBeNull();
  });
});
