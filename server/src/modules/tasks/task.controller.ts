import type { RequestHandler } from 'express';
import { HttpStatus } from '../../utils/http.js';
import * as taskService from './task.service.js';
import {
  createTaskSchema,
  idParamSchema,
  listTasksQuerySchema,
  statsQuerySchema,
  updateTaskSchema,
} from './task.schema.js';

// Express 5 forwards rejected promises to the error middleware, so no try/catch is needed.
// Zod parse errors are turned into 400 responses by that middleware.

export const list: RequestHandler = async (req, res) => {
  const query = listTasksQuerySchema.parse(req.query);
  res.json(await taskService.listTasks(query));
};

export const getOne: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ data: await taskService.getTask(id) });
};

export const create: RequestHandler = async (req, res) => {
  const input = createTaskSchema.parse(req.body);
  res.status(HttpStatus.Created).json({ data: await taskService.createTask(input) });
};

export const update: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const input = updateTaskSchema.parse(req.body);
  res.json({ data: await taskService.updateTask(id, input) });
};

export const remove: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  await taskService.deleteTask(id);
  res.status(HttpStatus.NoContent).end();
};

export const stats: RequestHandler = async (req, res) => {
  const { today } = statsQuerySchema.parse(req.query);
  res.json({ data: await taskService.getStats(today) });
};
