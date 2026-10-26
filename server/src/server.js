import 'dotenv/config';
import app from './app.js';
import { createRealtimeServer } from './realtime/socket.js';

const port = process.env.PORT || 5000;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('Set JWT_SECRET to a random secret of at least 32 characters in server/.env.');
  process.exit(1);
}

const { httpServer } = createRealtimeServer(app);
httpServer.listen(port, () => {
  console.log(`TaskSync API running at http://localhost:${port}`);
});
