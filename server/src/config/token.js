import jwt from 'jsonwebtoken';

export function verifyToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof payload !== 'object' || !/^[1-9]\d*$/.test(payload.sub || '') ||
      Number(payload.sub) > 4294967295 || !Number.isFinite(payload.exp)) {
    throw new Error('Invalid authentication token.');
  }
  return { id: Number(payload.sub), expiresAt: payload.exp * 1000 };
}
