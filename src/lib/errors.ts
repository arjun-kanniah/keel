/** An error with an HTTP status that is safe to show to the caller (and to the model). */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const forbidden = (message: string, detail?: Record<string, unknown>) =>
  new AppError(403, "forbidden", message, detail);
export const notFound = (what: string) => new AppError(404, "not_found", `${what} not found`);
export const conflict = (message: string, detail?: Record<string, unknown>) =>
  new AppError(409, "conflict", message, detail);
export const badRequest = (message: string, detail?: Record<string, unknown>) =>
  new AppError(400, "bad_request", message, detail);
export const unauthorized = (message = "Sign in first") => new AppError(401, "unauthorized", message);
export const tooMany = (message: string) => new AppError(429, "rate_limited", message);
