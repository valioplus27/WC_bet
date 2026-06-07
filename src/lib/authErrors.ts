/**
 * Supabase's auth error text is accurate but blunt — soften the ones people
 * actually run into. Shared between the sign-in flows and the "set a new
 * password" overlay, since both surface raw errors from the same API surface.
 */
export function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password — double check and try again.'
  if (/email rate limit/i.test(message)) return 'Too many emails sent — wait a few minutes and try again.'
  if (/password.*(least|character)/i.test(message)) return 'Password must be at least 6 characters.'
  if (/same.*(as|to).*(old|previous|current)/i.test(message)) return 'Please choose a different password than your current one.'
  return message
}
