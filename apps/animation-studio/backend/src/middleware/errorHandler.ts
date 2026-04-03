import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { ZodError } from 'zod';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  // Already responded
  if (res.headersSent) return next(err);

  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'VALIDATION_ERROR',
      details: err.flatten().fieldErrors,
    });
  }

  // Operational errors (expected)
  if (err instanceof AppError && err.isOperational) {
    if (err.statusCode >= 500) {
      logger.error(`[${req.requestId}] ${err.message}`, { stack: err.stack, path: req.path });
    }
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      requestId: req.requestId,
    });
  }

  // Knex errors
  if (err.code === '23505') { // unique violation
    return res.status(409).json({ error: 'Resource already exists', code: 'CONFLICT' });
  }
  if (err.code === '23503') { // foreign key violation
    return res.status(400).json({ error: 'Related resource not found', code: 'FOREIGN_KEY_VIOLATION' });
  }

  // Unknown errors
  logger.error(`[${req.requestId}] Unhandled error:`, {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  return res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId: req.requestId,
  });
};
