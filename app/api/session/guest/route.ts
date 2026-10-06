import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  getSharedAccountRepository,
  signSessionToken,
} from '@cardclash/server';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown;
      playerId?: unknown;
    };

    const rawName =
      typeof body.name === 'string' && body.name.trim().length > 0
        ? body.name.trim().slice(0, 24)
        : 'Player';

    const rawPlayerId =
      typeof body.playerId === 'string' && body.playerId.trim().length > 0
        ? body.playerId.trim()
        : `plr_${crypto.randomBytes(6).toString('hex')}`;

    const accountRepo = getSharedAccountRepository();
    const profile = await accountRepo.upsertAccount({
      playerId: rawPlayerId,
      name: rawName,
      email: null,
      isGuest: true,
    });

    const token = signSessionToken({
      playerId: rawPlayerId,
      name: rawName,
      email: null,
      isGuest: true,
    });

    return NextResponse.json({
      token,
      playerId: rawPlayerId,
      name: rawName,
      email: null,
      isGuest: true,
      profile,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to create guest session',
      },
      { status: 400 }
    );
  }
}
