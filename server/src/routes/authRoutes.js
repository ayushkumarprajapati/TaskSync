import { Router } from 'express';
import { register, login, me } from '../controllers/authController.js';
import authenticate from '../middleware/authMiddleware.js';
import { createAuthRateLimits } from '../middleware/authRateLimits.js';

const router = Router();
const limits = createAuthRateLimits();

router.post('/register', limits.registration, register);
router.post('/login', limits.loginIp, limits.loginAccount, login);
router.get('/me', authenticate, me);

export default router;
