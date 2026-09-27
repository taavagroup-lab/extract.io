export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'bad_request') => new AppError(400, code, message);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'unauthorized', message);
export const paymentRequired = (message: string) => new AppError(402, 'insufficient_balance', message);
export const forbidden = (message: string) => new AppError(403, 'forbidden', message);
export const notFound = (message: string) => new AppError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);
