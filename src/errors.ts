export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, options?: ErrorOptions) {
    super(400, "validation_error", message, options);
  }
}

export class NotFoundError extends ApiError {
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(404, code, message, options);
  }
}

export class ConflictError extends ApiError {
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(409, code, message, options);
  }
}

export class PayloadTooLargeError extends ApiError {
  constructor(message: string, options?: ErrorOptions) {
    super(413, "file_too_large", message, options);
  }
}

export class RequestAbortedError extends ApiError {
  constructor(options?: ErrorOptions) {
    super(
      400,
      "request_aborted",
      "The client closed the connection before the upload finished",
      options,
    );
  }
}
