import { z } from 'zod';
import { ErrorCode, HttpHeader, TaskPriority, TaskStatus } from 'shared';
import {
  createTaskSchema,
  idParamSchema,
  listTasksQuerySchema,
  statsQuerySchema,
  updateTaskSchema,
} from '../modules/tasks/task.schema.js';

/**
 * The OpenAPI document is generated from the same Zod schemas that validate requests, so the
 * documented limits, enums and defaults cannot drift from what the API actually enforces.
 * (`tests/openapi.test.ts` also fails if a route is added without being documented.)
 */

type JsonSchema = Record<string, unknown>;

const toSchema = (schema: z.ZodType): JsonSchema => {
  const jsonSchema = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
    target: 'openapi-3.0',
  }) as JsonSchema;
  delete jsonSchema.$schema; // OpenAPI 3.0 documents don't carry a JSON Schema dialect marker
  return jsonSchema;
};

// ---- response shapes (requests come straight from the validation schemas) ----

const taskSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/),
  title: z.string(),
  description: z.string(),
  status: z.enum(TaskStatus),
  priority: z.enum(TaskPriority),
  dueDate: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const pageMetaSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  totalPages: z.number().int(),
});

const statsSchema = z.object({
  total: z.number().int(),
  open: z.number().int(),
  overdue: z.number().int(),
  byStatus: z.object({
    [TaskStatus.Todo]: z.number().int(),
    [TaskStatus.InProgress]: z.number().int(),
    [TaskStatus.Done]: z.number().int(),
  }),
});

const errorSchema = z.object({
  error: z.object({
    code: z.enum(ErrorCode),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: JsonSchema) => ({ 'application/json': { schema } });
const errorResponse = (description: string) => ({
  description,
  content: json(ref('Error')),
});

const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: toSchema(idParamSchema.shape.id),
};

const requestIdHeader = {
  name: HttpHeader.RequestId,
  in: 'header',
  required: false,
  description: 'Correlation id (letters, digits, "-", "_"; max 64). Echoed back and logged.',
  schema: { type: 'string', maxLength: 64 },
};

const queryParameters = Object.entries(listTasksQuerySchema.shape).map(([name, schema]) => ({
  name,
  in: 'query',
  required: false,
  schema: toSchema(schema),
}));

const commonErrors = {
  '400': errorResponse('Validation failed (VALIDATION_ERROR, INVALID_JSON)'),
  '429': errorResponse('Rate limit exceeded (RATE_LIMITED)'),
  '500': errorResponse('Unexpected server error (INTERNAL_ERROR)'),
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Task Manager API',
    version: '1.0.0',
    description:
      'JSON API for managing tasks. Every error has the shape `{ error: { code, message, details? } }`.',
  },
  servers: [{ url: '/api' }],
  tags: [
    { name: 'Tasks', description: 'Create, read, update and delete tasks' },
    { name: 'Health', description: 'Liveness and readiness probes' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness: the process is up',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness: the database is connected',
        responses: {
          '200': { description: 'Ready to serve traffic' },
          '503': { description: 'Database not connected yet' },
        },
      },
    },
    '/tasks': {
      get: {
        tags: ['Tasks'],
        summary: 'List tasks',
        description: 'Filter, search, sort and paginate. Unknown query parameters are rejected.',
        parameters: [requestIdHeader, ...queryParameters],
        responses: {
          '200': {
            description: 'A page of tasks',
            content: json({
              type: 'object',
              properties: { data: { type: 'array', items: ref('Task') }, meta: ref('PageMeta') },
            }),
          },
          ...commonErrors,
        },
      },
      post: {
        tags: ['Tasks'],
        summary: 'Create a task',
        description:
          'Send an `Idempotency-Key` to make retries safe: the same key with the same body returns ' +
          'the original response (header `Idempotent-Replayed: true`) instead of creating a duplicate. ' +
          'Keys are remembered for 24 hours.',
        parameters: [
          requestIdHeader,
          {
            name: HttpHeader.IdempotencyKey,
            in: 'header',
            required: false,
            description:
              'Unique key for this logical request (8-128 characters: letters, digits, "-", "_").',
            schema: { type: 'string', minLength: 8, maxLength: 128 },
          },
        ],
        requestBody: { required: true, content: json(toSchema(createTaskSchema)) },
        responses: {
          '201': {
            description: 'Created (or replayed)',
            headers: {
              [HttpHeader.IdempotentReplayed]: {
                description: 'Present and `true` when replayed from an earlier request',
                schema: { type: 'string' },
              },
            },
            content: json({ type: 'object', properties: { data: ref('Task') } }),
          },
          ...commonErrors,
          '409': errorResponse(
            'Same Idempotency-Key still being processed (IDEMPOTENCY_REQUEST_IN_PROGRESS)',
          ),
          '413': errorResponse('Body larger than 10kb (PAYLOAD_TOO_LARGE)'),
          '422': errorResponse(
            'Idempotency-Key reused with a different body (IDEMPOTENCY_KEY_REUSED)',
          ),
        },
      },
    },
    '/tasks/stats': {
      get: {
        tags: ['Tasks'],
        summary: 'Task counts',
        description:
          'Totals by status plus the number of overdue open tasks. Pass `today` (YYYY-MM-DD) so ' +
          '"overdue" uses the caller\'s calendar day instead of server UTC.',
        parameters: [
          requestIdHeader,
          ...Object.entries(statsQuerySchema.shape).map(([name, schema]) => ({
            name,
            in: 'query',
            required: false,
            schema: toSchema(schema),
          })),
        ],
        responses: {
          '200': {
            description: 'Counts',
            content: json({ type: 'object', properties: { data: ref('TaskStats') } }),
          },
          ...commonErrors,
        },
      },
    },
    '/tasks/{id}': {
      get: {
        tags: ['Tasks'],
        summary: 'Get one task',
        parameters: [idParameter, requestIdHeader],
        responses: {
          '200': {
            description: 'The task',
            content: json({ type: 'object', properties: { data: ref('Task') } }),
          },
          '404': errorResponse('No such task (TASK_NOT_FOUND)'),
          ...commonErrors,
        },
      },
      patch: {
        tags: ['Tasks'],
        summary: 'Update a task',
        description:
          'Partial update: send only the fields to change (at least one). Safe to retry.',
        parameters: [idParameter, requestIdHeader],
        requestBody: { required: true, content: json(toSchema(updateTaskSchema)) },
        responses: {
          '200': {
            description: 'The updated task',
            content: json({ type: 'object', properties: { data: ref('Task') } }),
          },
          '404': errorResponse('No such task (TASK_NOT_FOUND)'),
          ...commonErrors,
        },
      },
      delete: {
        tags: ['Tasks'],
        summary: 'Delete a task',
        parameters: [idParameter, requestIdHeader],
        responses: {
          '204': { description: 'Deleted' },
          '404': errorResponse('No such task, or already deleted (TASK_NOT_FOUND)'),
          ...commonErrors,
        },
      },
    },
  },
  components: {
    schemas: {
      Task: toSchema(taskSchema),
      PageMeta: toSchema(pageMetaSchema),
      TaskStats: toSchema(statsSchema),
      Error: toSchema(errorSchema),
    },
  },
};
