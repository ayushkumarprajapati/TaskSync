import { Router } from 'express';
import authenticate from '../middleware/authMiddleware.js';
import { listTasks, summary, getTask, createTask, updateTask, updateStatus, deleteTask } from '../controllers/taskController.js';

const router = Router();
router.use(authenticate);
router.get('/', listTasks);
router.get('/summary', summary);
router.get('/:id', getTask);
router.post('/', createTask);
router.put('/:id', updateTask);
router.patch('/:id/status', updateStatus);
router.delete('/:id', deleteTask);
export default router;
