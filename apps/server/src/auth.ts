import crypto from 'node:crypto';

export interface SessionIdentity {
  readonly playerId: string;
  readonly name: string;
  readonly email?: string | null;
  readonly isGuest?: boolean;
  readonly iat: number;
}

const DEFAULT_DEV_SECRET = 'cardclash-dev-secret-change-in-production-32bytes';

export function getSessionSecret(overrideSecret?: string): string {
  return (
    overrideSecret ||
    process.env.SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    DEFAULT_DEV_SECRET
  );
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/**
 * Signs a session identity token using HMAC-SHA256.
 * Used both for instant Guest sessions (default) and Auth.js web-authenticated accounts.
 * Token format: `<base64url(payloadJSON)>.<base64url(hmac)>`
 */
export function signSessionToken(
  identity: {
    readonly playerId: string;
    readonly name: string;
    readonly email?: string | null;
    readonly isGuest?: boolean;
    readonly iat?: number;
  },
  secret?: string
): string {
  if (!identity.playerId || identity.playerId.trim().length === 0) {
    throw new Error('playerId is required to sign session token');
  }
  if (!identity.name || identity.name.trim().length === 0) {
    throw new Error('name is required to sign session token');
  }

  const normalizedEmail =
    typeof identity.email === 'string' && identity.email.trim().length > 0
      ? identity.email.trim().toLowerCase()
      : null;

  const isGuest =
    typeof identity.isGuest === 'boolean'
      ? identity.isGuest
      : normalizedEmail === null;

  const payload: SessionIdentity = {
    playerId: identity.playerId.trim(),
    name: identity.name.trim(),
    email: normalizedEmail,
    isGuest,
    iat: identity.iat ?? Date.now(),
  };

  const signingKey = getSessionSecret(secret);
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const hmac = crypto
    .createHmac('sha256', signingKey)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${hmac}`;
}

/**
 * Verifies an HMAC-SHA256 signed session token and returns the authenticated SessionIdentity,
 * or null if invalid or tampered.
 */
export function verifySessionToken(
  token: unknown,
  secret?: string
): SessionIdentity | null {
  if (typeof token !== 'string' || token.trim().length === 0) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    return null;
  }

  const signingKey = getSessionSecret(secret);
  const expectedSig = crypto
    .createHmac('sha256', signingKey)
    .update(encodedPayload)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSig, 'utf8');
  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const raw = JSON.parse(base64UrlDecode(encodedPayload)) as Record<
      string,
      unknown
    >;
    if (
      typeof raw.playerId !== 'string' ||
      raw.playerId.trim().length === 0 ||
      typeof raw.name !== 'string' ||
      raw.name.trim().length === 0 ||
      typeof raw.iat !== 'number'
    ) {
      return null;
    }

    const email =
      typeof raw.email === 'string' && raw.email.trim().length > 0
        ? raw.email.trim().toLowerCase()
        : null;
    const isGuest =
      typeof raw.isGuest === 'boolean' ? raw.isGuest : email === null;

    return {
      playerId: raw.playerId,
      name: raw.name,
      email,
      isGuest,
      iat: raw.iat,
    };
  } catch {
    return null;
  }
}
