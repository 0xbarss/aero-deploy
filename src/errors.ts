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

export class AppRequiredError extends ApiError {
  constructor(options?: ErrorOptions) {
    super(400, "app_required", "More than one app exists; pass appId or packageName", options);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "A valid admin token is required", options?: ErrorOptions) {
    super(401, "unauthorized", message, options);
  }
}

export class AdminDisabledError extends ApiError {
  constructor(options?: ErrorOptions) {
    super(
      403,
      "admin_disabled",
      "Admin routes are disabled because ADMIN_TOKEN is not set",
      options,
    );
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

export class InvalidApkError extends ApiError {
  constructor(message: string, options?: ErrorOptions) {
    super(422, "invalid_apk", message, options);
  }
}

export class ManifestMismatchError extends ApiError {
  constructor(message: string, options?: ErrorOptions) {
    super(422, "manifest_mismatch", message, options);
  }
}
