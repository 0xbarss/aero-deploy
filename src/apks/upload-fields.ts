import { z } from "zod";
import { ValidationError } from "../errors.js";

const MAX_INT4 = 2_147_483_647;

// PostgreSQL text columns cannot hold a NUL byte, so it would surface as a 500 at insert time
const hasNoNulByte = (value: string): boolean => !value.includes("\u0000");
const NUL_MESSAGE = "must not contain NUL bytes";

// versionName, versionCode and packageName are optional claims about the APK; when sent they must
// agree with its manifest. appName only names an app that the upload creates.
const uploadFieldsSchema = z.object({
  versionName: z
    .string()
    .trim()
    .min(1, "versionName must not be empty")
    .max(50, "versionName must be at most 50 characters")
    .refine(hasNoNulByte, `versionName ${NUL_MESSAGE}`)
    .optional(),
  versionCode: z
    .string()
    .regex(/^\d+$/, "versionCode must be a positive integer")
    .transform(Number)
    .pipe(
      z
        .number()
        .min(1, "versionCode must be a positive integer")
        .max(MAX_INT4, "versionCode is too large"),
    )
    .optional(),
  packageName: z
    .string()
    .trim()
    .min(1, "packageName must not be empty")
    .max(255, "packageName must be at most 255 characters")
    .refine(hasNoNulByte, `packageName ${NUL_MESSAGE}`)
    .optional(),
  appName: z
    .string()
    .trim()
    .max(1000, "appName must be at most 1000 characters")
    .refine(hasNoNulByte, `appName ${NUL_MESSAGE}`)
    .optional(),
  releaseNotes: z
    .string()
    .max(10_000, "releaseNotes must be at most 10000 characters")
    .refine(hasNoNulByte, `releaseNotes ${NUL_MESSAGE}`)
    .optional(),
});

export interface UploadFields {
  versionName: string | null;
  versionCode: number | null;
  packageName: string | null;
  appName: string | null;
  releaseNotes: string | null;
}

export function parseUploadFields(fields: Record<string, string>): UploadFields {
  const result = uploadFieldsSchema.safeParse(fields);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  const { versionName, versionCode, packageName, appName, releaseNotes } = result.data;
  return {
    versionName: versionName ?? null,
    versionCode: versionCode ?? null,
    packageName: packageName ?? null,
    appName: appName === undefined || appName === "" ? null : appName,
    releaseNotes: releaseNotes === undefined || releaseNotes.trim() === "" ? null : releaseNotes,
  };
}
