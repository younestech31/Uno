import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  getSharedAccountRepository,
  signSessionToken,
  verifySessionToken,
} from '@cardclash/server';

/**
 * Auth.js-compatible web session issuer (`apps/web`).
 * - POST `/api/auth/session`: Signs in or claims an account with `email` and `name`.
 *   Web issues the HMAC-SHA256 signed session token (`isGuest: false`); server verifies it on Socket handshake.
 * - GET `/api/auth/session`: Verifies a bearer/query token and returns the current account profile.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      name?: unknown;
      playerId?: unknown;
    };

    const rawEmail =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!rawEmail || !rawEmail.includes('@')) {
      return NextResponse.json(
        { error: 'Please provide a valid email address to sign in' },
        { status: 400 }
      );
    }

    const accountRepo = getSharedAccountRepository();
    const existingByEmail = await accountRepo.findAccountByEmail(rawEmail);

    const resolvedPlayerId =
      existingByEmail?.playerId ??
      (typeof body.playerId === 'string' && body.playerId.trim().length > 0
        ? body.playerId.trim()
        : `acc_${crypto.randomBytes(6).toString('hex')}`);

    const defaultHandle = rawEmail.split('@')[0]?.slice(0, 24) || 'Player';
    const resolvedName =
      typeof body.name === 'string' && body.name.trim().length > 0
        ? body.name.trim().slice(0, 24)
        : existingByEmail?.name ?? defaultHandle;

    const profile = await accountRepo.upsertAccount({
      playerId: resolvedPlayerId,
      name: resolvedName,
      email: rawEmail,
      isGuest: false,
    });

    const token = signSessionToken({
      playerId: profile.playerId,
      name: profile.name,
      email: profile.email,
      isGuest: false,
    });

    return NextResponse.json({
      token,
      playerId: profile.playerId,
      name: profile.name,
      email: profile.email,
      isGuest: false,
      profile,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to issue account session',
      },
      { status: 400 }
    );
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : req.nextUrl.searchParams.get('token');

  const identity = verifySessionToken(bearerToken);
  if (!identity) {
    return NextResponse.json({ authenticated: false, identity: null }, { status: 401 });
  }

  const accountRepo = getSharedAccountRepository();
  const profile = await accountRepo.getAccount(identity.playerId);

  return NextResponse.json({
    authenticated: true,
    identity,
    profile,
  });
}
