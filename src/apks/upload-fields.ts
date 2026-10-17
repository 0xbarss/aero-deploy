import { z } from "zod";
import { ValidationError } from "../errors.js";

const MAX_INT4 = 2_147_483_647;

// PostgreSQL text columns cannot hold a NUL byte, so it would surface as a 500 at insert time
const hasNoNulByte = (value: string): boolean => !value.includes("\u0000");
const NUL_MESSAGE = "must not contain NUL bytes";

const uploadFieldsSchema = z.object({
  versionName: z
    .string({ error: "versionName is required" })
    .trim()
    .min(1, "versionName must not be empty")
    .max(50, "versionName must be at most 50 characters")
    .refine(hasNoNulByte, `versionName ${NUL_MESSAGE}`),
  versionCode: z
    .string({ error: "versionCode is required" })
    .regex(/^\d+$/, "versionCode must be a positive integer")
    .transform(Number)
    .pipe(
      z
        .number()
        .min(1, "versionCode must be a positive integer")
        .max(MAX_INT4, "versionCode is too large"),
    ),
  releaseNotes: z
    .string()
    .max(10_000, "releaseNotes must be at most 10000 characters")
    .refine(hasNoNulByte, `releaseNotes ${NUL_MESSAGE}`)
    .optional(),
});

export interface UploadFields {
  versionName: string;
  versionCode: number;
  releaseNotes: string | null;
}

export function parseUploadFields(fields: Record<string, string>): UploadFields {
  const result = uploadFieldsSchema.safeParse(fields);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  const { versionName, versionCode, releaseNotes } = result.data;
  return {
    versionName,
    versionCode,
    releaseNotes: releaseNotes === undefined || releaseNotes.trim() === "" ? null : releaseNotes,
  };
}
