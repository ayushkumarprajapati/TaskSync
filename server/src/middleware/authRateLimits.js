import { rateLimit } from 'express-rate-limit';

export function createAuthRateLimits({ windowMs = 15 * 60 * 1000, registrationLimit = 10, loginIpLimit = 30, loginAccountLimit = 10 } = {}) {
  const common = { windowMs, standardHeaders: 'draft-8', legacyHeaders: false };
  const registration = rateLimit({
    ...common, limit: registrationLimit, identifier: 'registration-ip',
    message: { error: { message: 'Too many registration attempts. Please try again later.' } },
  });
  const loginIp = rateLimit({
    ...common, limit: loginIpLimit, identifier: 'login-ip',
    message: { error: { message: 'Too many login attempts. Please try again later.' } },
  });
  const loginAccount = rateLimit({
    ...common, limit: loginAccountLimit, identifier: 'login-account',
    skipSuccessfulRequests: true,
    skip: req => typeof req.body?.email !== 'string' || !req.body.email.trim() || req.body.email.length > 255,
    keyGenerator: req => req.body.email.trim().toLowerCase(),
    message: { error: { message: 'Too many failed login attempts for this account. Please try again later.' } },
  });
  return { registration, loginIp, loginAccount };
}
