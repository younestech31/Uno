import http from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { createCardClashServer } from './apps/server/src/index';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

async function bootstrap() {
  const nextApp = next({ dev, hostname, port });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  const httpServer = http.createServer((req, res) => {
    // Socket.IO requests are handled by the attached Engine.IO listener
    if (req.url?.startsWith('/socket.io')) {
      return;
    }
    const parsedUrl = parse(req.url ?? '/', true);
    void handle(req, res, parsedUrl);
  });

  const cardClashServer = createCardClashServer({
    httpServer,
  });

  httpServer.listen(port, hostname, () => {
    console.log(
      `[CardClash] Unified Web + Socket.IO Server listening on http://${hostname}:${port} (store=${cardClashServer.store.backend})`
    );
  });
}

void bootstrap();
