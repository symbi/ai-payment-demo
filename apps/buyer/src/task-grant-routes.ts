import express, { type ErrorRequestHandler, type RequestHandler, type Response, type Router } from 'express';
import { TaskGrantError, TaskGrantStore } from './task-grant-store.ts';

const PATH = '/api/task-grant';

const noStore: RequestHandler = (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
};

function publicError(error: unknown): TaskGrantError {
  return error instanceof TaskGrantError ? error : new TaskGrantError(503, 'task_grant_unavailable');
}

function sendError(response: Response, error: unknown): void {
  const safe = publicError(error);
  response.status(safe.status).json({ error: safe.message, code: safe.code });
}

export function createTaskGrantRouter(store: TaskGrantStore): Router {
  const router = express.Router();
  const json = express.json({ limit: '4kb', strict: true });

  router.get(PATH, noStore, async (_request, response) => {
    try {
      response.json(await store.status());
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post(PATH, noStore, json, async (request, response) => {
    try {
      response.json(await store.save(request.body));
    } catch (error) {
      sendError(response, error);
    }
  });

  const bodyErrors: ErrorRequestHandler = (error, request, response, next) => {
    if (request.method === 'POST' && request.path === PATH
      && (error instanceof SyntaxError || error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed')) {
      sendError(response, new TaskGrantError(error?.type === 'entity.too.large' ? 413 : 400, 'invalid_task_grant'));
      return;
    }
    next(error);
  };
  router.use(bodyErrors);
  return router;
}
