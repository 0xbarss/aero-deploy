import { ApiError, RequestAbortedError, ValidationError } from "../errors.js";

// busboy raises these as plain errors without a status code or error code
const MALFORMED_MULTIPART_MESSAGES = [
  /^Multipart: Boundary not found$/,
  /^Unexpected end of multipart data$/,
  /terminated early due to unexpected end of multipart data$/,
];

/**
 * Turns the errors a bad or interrupted multipart body produces into typed API errors.
 * Anything else, such as a disk or database failure, is returned unchanged.
 */
export function translateMultipartError(error: unknown): unknown {
  if (error instanceof ApiError || !(error instanceof Error)) {
    return error;
  }
  if ((error as NodeJS.ErrnoException).code === "ERR_STREAM_PREMATURE_CLOSE") {
    return new RequestAbortedError({ cause: error });
  }
  if (MALFORMED_MULTIPART_MESSAGES.some((pattern) => pattern.test(error.message))) {
    return new ValidationError("request body is not valid multipart/form-data", { cause: error });
  }
  return error;
}
