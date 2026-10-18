import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { AdminDisabledError, UnauthorizedError } from "./errors.js";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Throws 403 when the server has no admin token and 401 unless the request carries it as a
 * bearer token. Hashing both sides first keeps the comparison time independent of the content.
 */
export function assertAdmin(request: FastifyRequest, adminToken: string | undefined): void {
  if (adminToken === undefined) {
    throw new AdminDisabledError();
  }
  const match = /^bearer (.*)$/i.exec(request.headers.authorization ?? "");
  if (match === null || !timingSafeEqual(digest(match[1] ?? ""), digest(adminToken))) {
    throw new UnauthorizedError();
  }
}
