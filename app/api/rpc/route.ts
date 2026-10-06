import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  RoomManager,
  getSharedAccountRepository,
  getSharedStateStore,
  verifySessionToken,
  getSessionSecret,
  toPublicRoomState,
} from '@cardclash/server';
import { getPlayerView } from '@cardclash/engine';

function signSnapshot(snapshot: any): string {
  const data = JSON.stringify(snapshot);
  const hmac = crypto
    .createHmac('sha256', getSessionSecret())
    .update(data)
    .digest('hex');
  return `${Buffer.from(data).toString('base64')}.${hmac}`;
}

function verifyAndDecodeSnapshot(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadBase64, sig] = parts;
    if (!payloadBase64 || !sig) return null;
    const data = Buffer.from(payloadBase64, 'base64').toString('utf8');
    const hmac = crypto
      .createHmac('sha256', getSessionSecret())
      .update(data)
      .digest('hex');
    if (sig !== hmac) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const identity = verifySessionToken(token);
    if (!identity) {
      return NextResponse.json({ error: 'Unauthorized session' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      type: string;
      payload?: any;
      roomCode?: string;
      snapshotToken?: string;
    };

    const store = getSharedStateStore();
    const accountRepo = getSharedAccountRepository();
    const manager = new RoomManager(store, accountRepo);

    // Stateless serverless safety: Hydrate room state if snapshotToken is validated
    let hydratedRoomCode = body.roomCode?.toUpperCase();
    if (body.snapshotToken) {
      const decodedSnapshot = verifyAndDecodeSnapshot(body.snapshotToken);
      if (decodedSnapshot && decodedSnapshot.roomCode) {
        const roomCodeStr = decodedSnapshot.roomCode.toUpperCase();
        hydratedRoomCode = roomCodeStr;
        const existing = await store.getRoomSnapshot(roomCodeStr);
        if (!existing || existing.updatedAt < decodedSnapshot.updatedAt) {
          await store.saveRoomSnapshot(decodedSnapshot);
          for (const p of decodedSnapshot.players) {
            await store.setPlayerRoom(p.id, roomCodeStr);
          }
        }
      }
    }

    const type = body.type;
    const payload = body.payload ?? {};

    let responseData: any = {};
    let updatedSnapshot: any = null;

    if (type === 'room:create') {
      const result = await manager.createRoom(identity, payload);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      responseData = { room: result.data.room };
      updatedSnapshot = await store.getRoomSnapshot(result.data.room.roomCode);
    } else if (type === 'room:join') {
      const targetRoomCode = String(payload.roomCode ?? body.roomCode).toUpperCase();
      const result = await manager.joinRoom(identity, targetRoomCode);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      responseData = {
        room: result.data.room,
        view: result.data.view,
        turnDeadlineAt: result.data.turnDeadlineAt,
      };
      updatedSnapshot = await store.getRoomSnapshot(targetRoomCode);
    } else if (type === 'room:spectate') {
      const targetRoomCode = String(payload.roomCode ?? body.roomCode).toUpperCase();
      const result = await manager.spectateRoom(identity, targetRoomCode);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      responseData = {
        room: result.data.room,
        view: result.data.view,
        turnDeadlineAt: result.data.turnDeadlineAt,
      };
      updatedSnapshot = await store.getRoomSnapshot(targetRoomCode);
    } else if (type === 'room:leave') {
      const targetRoomCode = String(body.roomCode).toUpperCase();
      const result = await manager.leaveRoom(identity.playerId, targetRoomCode);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      responseData = { room: result.data.room };
      updatedSnapshot = result.data.room
        ? await store.getRoomSnapshot(targetRoomCode)
        : null;
    } else if (type === 'room:ready') {
      const targetRoomCode = String(body.roomCode).toUpperCase();
      const result = await manager.setReady(identity.playerId, Boolean(payload.ready), targetRoomCode);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      responseData = { room: result.data.room };
      updatedSnapshot = await store.getRoomSnapshot(targetRoomCode);
    } else if (type === 'room:start') {
      const targetRoomCode = String(body.roomCode).toUpperCase();
      const result = await manager.startMatch(identity.playerId, targetRoomCode);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      responseData = {
        room: result.data.room,
        matchId: result.data.matchId,
        events: result.data.events,
        viewsByPlayer: result.data.viewsByPlayer,
      };
      updatedSnapshot = await store.getRoomSnapshot(targetRoomCode);
    } else if (type === 'room:rematch') {
      const targetRoomCode = String(body.roomCode).toUpperCase();
      const result = await manager.rematch(identity.playerId, targetRoomCode);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      responseData = {
        room: result.data.room,
        matchId: result.data.matchId,
        events: result.data.events,
        viewsByPlayer: result.data.viewsByPlayer,
      };
      updatedSnapshot = await store.getRoomSnapshot(targetRoomCode);
    } else if (type === 'game:action') {
      const targetRoomCode = String(body.roomCode).toUpperCase();
      const result = await manager.handleGameAction(identity.playerId, payload, targetRoomCode);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      responseData = {
        room: result.data.room,
        matchId: result.data.matchId,
        events: result.data.events,
        viewsByPlayer: result.data.viewsByPlayer,
      };
      updatedSnapshot = await store.getRoomSnapshot(targetRoomCode);
    } else if (type === 'room:sync') {
      const targetRoomCode = String(body.roomCode).toUpperCase();
      const snapshot = await store.getRoomSnapshot(targetRoomCode);
      if (!snapshot) {
        return NextResponse.json({ error: 'Room not found' }, { status: 404 });
      }
      const isSpectator = snapshot.spectators?.some((s) => s.id === identity.playerId);
      const isPlayer = snapshot.players.some((p) => p.id === identity.playerId);
      if (!isPlayer && !isSpectator) {
        return NextResponse.json({ error: 'Not in room' }, { status: 403 });
      }
      const view = snapshot.gameState
        ? isSpectator
          ? manager.getSpectatorView(snapshot.gameState, identity.playerId)
          : getPlayerView(snapshot.gameState, identity.playerId)
        : null;

      responseData = {
        room: toPublicRoomState(snapshot),
        view,
        turnDeadlineAt: snapshot.turnDeadlineAt ?? null,
      };
      updatedSnapshot = snapshot;
    } else {
      return NextResponse.json({ error: 'Unsupported RPC action' }, { status: 400 });
    }

    const responseEnvelope: any = {
      ok: true,
      data: responseData,
    };

    if (updatedSnapshot) {
      responseEnvelope.snapshotToken = signSnapshot(updatedSnapshot);
    }

    return NextResponse.json(responseEnvelope);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}
