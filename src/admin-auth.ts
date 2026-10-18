import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { AdminDisabledError, UnauthorizedError } from "./errors.js";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Hashing both sides first keeps the comparison time independent of the content. */
function carriesBearerToken(request: FastifyRequest, token: string): boolean {
  const match = /^bearer (.*)$/i.exec(request.headers.authorization ?? "");
  return match !== null && timingSafeEqual(digest(match[1] ?? ""), digest(token));
}

/** Throws 403 when the server has no admin token and 401 unless the request carries it as a bearer token. */
export function assertAdmin(request: FastifyRequest, adminToken: string | undefined): void {
  if (adminToken === undefined) {
    throw new AdminDisabledError();
  }
  if (!carriesBearerToken(request, adminToken)) {
    throw new UnauthorizedError();
  }
}

export interface UploadTokens {
  uploadToken?: string | undefined;
  adminToken?: string | undefined;
}

/**
 * Uploads are open while the server has no upload token. Once it has one, the request must carry
 * it, or the admin token, as a bearer token; otherwise this throws 401.
 */
export function assertUploadAllowed(request: FastifyRequest, tokens: UploadTokens): void {
  const { uploadToken, adminToken } = tokens;
  if (uploadToken === undefined) {
    return;
  }
  const accepted =
    carriesBearerToken(request, uploadToken) ||
    (adminToken !== undefined && carriesBearerToken(request, adminToken));
  if (!accepted) {
    throw new UnauthorizedError("A valid upload token is required");
  }
}
