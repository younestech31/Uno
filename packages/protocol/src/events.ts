export const SOCKET_EVENTS = {
  // Client -> Server intents
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  ROOM_SPECTATE: 'room:spectate',
  ROOM_LEAVE: 'room:leave',
  ROOM_READY: 'room:ready',
  ROOM_START: 'room:start',
  ROOM_REMATCH: 'room:rematch',
  GAME_ACTION: 'game:action',
  SESSION_HEARTBEAT: 'session:heartbeat',
  CHAT_SEND: 'chat:send',
  CHAT_REPORT: 'chat:report',

  // Server -> Client broadcasts / events
  ROOM_STATE: 'room:state',
  GAME_VIEW: 'game:view',
  GAME_EVENTS: 'game:events',
  CHAT_MESSAGE: 'chat:message',
  ERROR_EVENT: 'error:event',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
