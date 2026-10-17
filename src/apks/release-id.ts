import { z } from "zod";
import { ValidationError } from "../errors.js";

const MAX_INT4 = 2_147_483_647;

const releaseIdSchema = z
  .string()
  .regex(/^\d+$/, "id must be a positive integer")
  .transform(Number)
  .pipe(z.number().min(1, "id must be a positive integer").max(MAX_INT4, "id is too large"));

export function parseReleaseId(raw: string): number {
  const result = releaseIdSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
