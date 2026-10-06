import type { NextApiRequest, NextApiResponse } from 'next';
import type http from 'node:http';
import type { Socket as NetSocket } from 'node:net';
import {
  createCardClashServer,
  type CardClashServerInstance,
} from '@cardclash/server';

interface SocketServerWithCardClash extends http.Server {
  cardClashServer?: CardClashServerInstance;
}

interface NextSocketWithServer extends NetSocket {
  server: SocketServerWithCardClash;
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const socket = res.socket as NextSocketWithServer | null;
  if (socket?.server && !socket.server.cardClashServer) {
    socket.server.cardClashServer = createCardClashServer({
      httpServer: socket.server,
    });
  }
  res.status(200).json({
    ok: true,
    store: socket?.server?.cardClashServer?.store.backend ?? 'memory',
  });
}
