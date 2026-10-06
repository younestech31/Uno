import { NextRequest, NextResponse } from 'next/server';
import { getSharedAccountRepository } from '@cardclash/server';

export async function GET(req: NextRequest) {
  try {
    const playerId = req.nextUrl.searchParams.get('playerId') ?? undefined;
    const accountRepo = getSharedAccountRepository();

    const [leaderboard, recentMatches] = await Promise.all([
      accountRepo.getLeaderboard(20),
      accountRepo.getRecentMatches(15, playerId),
    ]);

    return NextResponse.json({
      leaderboard,
      recentMatches,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to load leaderboard',
      },
      { status: 500 }
    );
  }
}
