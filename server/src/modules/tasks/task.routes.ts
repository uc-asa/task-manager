import { Router } from 'express';
import { idempotent } from '../idempotency/idempotency.middleware.js';
import * as controller from './task.controller.js';

export const taskRouter = Router();

// Responses change whenever a task does, so clients must revalidate before reusing them. Express
// adds a weak ETag to every JSON response, so an unchanged list costs a 304 with no body.
taskRouter.use((req, res, next) => {
  if (req.method === 'GET') res.setHeader('Cache-Control', 'no-cache');
  next();
});

taskRouter.get('/', controller.list);
// POST is the one non-idempotent operation, so it accepts an optional Idempotency-Key.
taskRouter.post('/', idempotent, controller.create);
// Must come before '/:id', or "stats" would be treated as a task id.
taskRouter.get('/stats', controller.stats);
taskRouter.get('/:id', controller.getOne);
taskRouter.patch('/:id', controller.update);
taskRouter.delete('/:id', controller.remove);
