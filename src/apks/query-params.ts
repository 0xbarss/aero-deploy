import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { ReleaseFilter } from "./repository.js";

const MAX_INT4 = 2_147_483_647;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// PostgreSQL text parameters cannot hold a NUL byte
const hasNoNulByte = (value: string): boolean => !value.includes("\u0000");

const digits = (name: string) =>
  z.string().regex(/^\d+$/, `${name} must be a non-negative integer`);

const filterSchema = z.object({
  appId: digits("appId")
    .transform(Number)
    .pipe(z.number().min(1, "appId must be a positive integer").max(MAX_INT4, "appId is too large"))
    .optional(),
  packageName: z
    .string()
    .min(1, "packageName must not be empty")
    .max(255, "packageName must be at most 255 characters")
    .refine(hasNoNulByte, "packageName must not contain NUL bytes")
    .optional(),
});

const pageSchema = z.object({
  limit: digits("limit")
    .transform(Number)
    .pipe(
      z
        .number()
        .min(1, "limit must be between 1 and 200")
        .max(MAX_LIMIT, "limit must be between 1 and 200"),
    )
    .default(DEFAULT_LIMIT),
  offset: digits("offset")
    .transform(Number)
    .pipe(z.number().max(MAX_INT4, "offset is too large"))
    .default(0),
});

export interface Page {
  limit: number;
  offset: number;
}

function parse<T>(schema: z.ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}

function toFilter(parsed: {
  appId?: number | undefined;
  packageName?: string | undefined;
}): ReleaseFilter {
  const filter: ReleaseFilter = {};
  if (parsed.appId !== undefined) {
    filter.appId = parsed.appId;
  }
  if (parsed.packageName !== undefined) {
    filter.packageName = parsed.packageName;
  }
  return filter;
}

export function parseReleaseFilter(query: unknown): ReleaseFilter {
  return toFilter(parse(filterSchema, query));
}

export function parseListQuery(query: unknown): { filter: ReleaseFilter; page: Page } {
  return {
    filter: toFilter(parse(filterSchema, query)),
    page: parse(pageSchema, query),
  };
}
