import { z } from "zod";
import { ValidationError } from "../errors.js";

// Matches the length of apps.name
const MAX_NAME_LENGTH = 100;
// C0 and C1 control characters, which include the NUL byte PostgreSQL cannot store
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

const renameSchema = z.object({
  name: z
    .string({ error: "name is required" })
    .trim()
    .min(1, "name must not be empty")
    .refine(
      (value) => Array.from(value).length <= MAX_NAME_LENGTH,
      `name must be at most ${MAX_NAME_LENGTH} characters`,
    )
    .refine((value) => !CONTROL_CHARACTERS.test(value), "name must not contain control characters"),
});

/** Reads the new name from a PATCH /api/apps/:id body. */
export function parseRenameBody(body: unknown): string {
  const result = renameSchema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data.name;
}
