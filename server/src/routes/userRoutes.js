import { Router } from 'express';
import authenticate from '../middleware/authMiddleware.js';
import { listUsers } from '../controllers/userController.js';

const router = Router();
router.use(authenticate);
router.get('/', listUsers);
export default router;
