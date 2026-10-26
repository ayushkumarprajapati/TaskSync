import { createServer } from 'node:http';
import { Server } from 'socket.io';
import pool from '../config/db.js';
import { verifyToken } from '../config/token.js';

const room = 'authenticated';

export function disconnectUserSockets(io, userId) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}

async function authorizedSocketIds(io) {
  const sockets = [...io.of('/').sockets.values()];
  if (!sockets.length) return [];
  const userIds = [...new Set(sockets.map(socket => socket.data.user.id))];
  const [users] = await pool.execute(`SELECT id FROM users WHERE id IN (${userIds.map(() => '?').join(', ')})`, userIds);
  const existing = new Set(users.map(user => user.id));
  const authorized = [];
  for (const socket of sockets) {
    if (!socket.connected) continue;
    if (!existing.has(socket.data.user.id) || socket.data.user.expiresAt <= Date.now()) socket.disconnect(true);
    else authorized.push(socket.id);
  }
  return authorized;
}

export function createRealtimeServer(app, { accountCheckIntervalMs = 30000 } = {}) {
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  app.set('io', io);

  io.use(async (socket, next) => {
    let user;
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('Missing token');
      user = verifyToken(token);
    } catch {
      return next(Object.assign(new Error('Authentication required.'), { data: { code: 'AUTH_FAILED' } }));
    }
    try {
      const [users] = await pool.execute('SELECT id FROM users WHERE id = ?', [user.id]);
      if (!users.length || user.expiresAt <= Date.now()) {
        return next(Object.assign(new Error('Authentication required.'), { data: { code: 'AUTH_FAILED' } }));
      }
      socket.data.user = user;
      next();
    } catch {
      next(Object.assign(new Error('Real-time connection temporarily unavailable.'), { data: { code: 'SERVICE_UNAVAILABLE' } }));
    }
  });

  io.on('connection', socket => {
    socket.join(room);
    socket.join(`user:${socket.data.user.id}`);
    // Handshake middleware runs only at connection time, so expire live sessions too.
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.user.expiresAt - Date.now()));
    timer.unref();
    socket.on('disconnect', () => clearTimeout(timer));
    // No mutation or rebroadcast handlers: all writes go through REST controllers.
  });

  // One batched check per server, rather than one polling timer/query per socket.
  // Deleted accounts are also removed while the workspace is otherwise idle.
  let checking = false;
  const accountTimer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try { await authorizedSocketIds(io); }
    catch (error) { console.error(`Socket account check unavailable: ${error.code || error.name}`); }
    finally { checking = false; }
  }, accountCheckIntervalMs);
  accountTimer.unref();
  httpServer.once('close', () => clearInterval(accountTimer));

  return { httpServer, io };
}

export async function broadcastTaskChange(req, action, taskId) {
  const io = req.app.get('io');
  if (!io) return;
  try {
    // Recheck before every outgoing task event, not just at the handshake.
    const recipients = await authorizedSocketIds(io);
    if (recipients.length) io.to(recipients).emit('tasks:changed', { action, taskId });
  } catch (error) {
    // Fail closed: no event is sent if account authorization cannot be verified.
    // The SQL mutation already succeeded; notification failure must not undo it.
    console.error(`Task broadcast authorization unavailable: ${error.code || error.name}`);
  }
}
