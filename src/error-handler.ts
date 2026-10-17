import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";

interface ErrorBody {
  success: false;
  error: { code: string; message: string };
}

function errorBody(code: string, message: string): ErrorBody {
  return { success: false, error: { code, message } };
}

function clientErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || !("statusCode" in error)) {
    return undefined;
  }
  const { statusCode } = error;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined;
}

/** Handles errors Fastify raises before a route runs, such as a URL with broken percent-encoding. */
export function handleFrameworkError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error.code === "FST_ERR_BAD_URL") {
    request.log.warn({ event: "request.rejected", statusCode: 400, code: "bad_request" });
    void reply.code(400).send(errorBody("bad_request", "Request URL is not valid"));
    return;
  }
  request.log.error({ event: "request.failed", err: error });
  void reply.code(500).send(errorBody("internal_error", "Internal server error"));
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0];
    return reply
      .code(404)
      .send(errorBody("not_found", `Route ${request.method} ${path} not found`));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      request.log.warn({
        event: "request.rejected",
        statusCode: error.statusCode,
        code: error.code,
      });
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }

    const statusCode = clientErrorStatus(error);
    if (statusCode !== undefined && error instanceof Error) {
      const code = statusCode === 413 ? "payload_too_large" : "bad_request";
      request.log.warn({ event: "request.rejected", statusCode, code });
      return reply.code(statusCode).send(errorBody(code, error.message));
    }

    request.log.error({ event: "request.failed", err: error });
    return reply.code(500).send(errorBody("internal_error", "Internal server error"));
  });
}
