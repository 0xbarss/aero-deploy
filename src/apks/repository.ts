import { DatabaseError, type Pool } from "pg";
import { ConflictError } from "../errors.js";

export interface NewApkRelease {
  appId: number;
  versionName: string;
  versionCode: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  /** Null for releases stored before checksums were recorded. */
  sha256: string | null;
  releaseNotes: string | null;
}

export interface ApkRelease extends NewApkRelease {
  id: number;
  createdAt: Date;
}

export interface ApkReleaseWithApp extends ApkRelease {
  appName: string;
}

export interface ReleaseFilter {
  appId?: number;
  packageName?: string;
}

interface ApkReleaseRow {
  id: number;
  app_id: number;
  version_name: string;
  version_code: number;
  file_name: string;
  file_path: string;
  file_size: string;
  sha256: string | null;
  release_notes: string | null;
  created_at: Date;
}

interface ApkReleaseWithAppRow extends ApkReleaseRow {
  app_name: string;
}

const UNIQUE_VIOLATION = "23505";

function toRelease(row: ApkReleaseRow): ApkRelease {
  return {
    id: row.id,
    appId: row.app_id,
    versionName: row.version_name,
    versionCode: row.version_code,
    fileName: row.file_name,
    filePath: row.file_path,
    // BIGINT arrives as a string; APK sizes stay far below Number.MAX_SAFE_INTEGER
    fileSize: Number(row.file_size),
    sha256: row.sha256,
    releaseNotes: row.release_notes,
    createdAt: row.created_at,
  };
}

export async function insertRelease(pool: Pool, release: NewApkRelease): Promise<ApkRelease> {
  try {
    const result = await pool.query<ApkReleaseRow>(
      `INSERT INTO apk_releases
         (app_id, version_name, version_code, file_name, file_path, file_size, sha256,
          release_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        release.appId,
        release.versionName,
        release.versionCode,
        release.fileName,
        release.filePath,
        release.fileSize,
        release.sha256,
        release.releaseNotes,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("insert into apk_releases returned no row");
    }
    return toRelease(row);
  } catch (error) {
    if (error instanceof DatabaseError && error.code === UNIQUE_VIOLATION) {
      throw new ConflictError(
        "version_code_exists",
        `versionCode ${release.versionCode} is already registered`,
        { cause: error },
      );
    }
    throw error;
  }
}

/** Builds the WHERE clause for a filter and returns it with its positional parameters. */
function filterClause(filter: ReleaseFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.appId !== undefined) {
    params.push(filter.appId);
    conditions.push(`r.app_id = $${params.length}`);
  }
  if (filter.packageName !== undefined) {
    params.push(filter.packageName);
    conditions.push(`a.package_name = $${params.length}`);
  }
  return { where: conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`, params };
}

export async function findLatestRelease(
  pool: Pool,
  filter: ReleaseFilter = {},
): Promise<ApkRelease | undefined> {
  const { where, params } = filterClause(filter);
  const result = await pool.query<ApkReleaseRow>(
    `SELECT r.* FROM apk_releases r JOIN apps a ON a.id = r.app_id
      ${where}
      ORDER BY r.version_code DESC, r.id DESC
      LIMIT 1`,
    params,
  );
  const row = result.rows[0];
  return row === undefined ? undefined : toRelease(row);
}

export interface ReleasePage {
  items: ApkReleaseWithApp[];
  total: number;
}

export async function listReleases(
  pool: Pool,
  filter: ReleaseFilter,
  page: { limit: number; offset: number },
): Promise<ReleasePage> {
  const { where, params } = filterClause(filter);
  const [items, count] = await Promise.all([
    pool.query<ApkReleaseWithAppRow>(
      `SELECT r.*, a.name AS app_name
         FROM apk_releases r JOIN apps a ON a.id = r.app_id
         ${where}
         ORDER BY r.version_code DESC, r.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, page.limit, page.offset],
    ),
    pool.query<{ count: string }>(
      `SELECT count(*) FROM apk_releases r JOIN apps a ON a.id = r.app_id ${where}`,
      params,
    ),
  ]);
  return {
    items: items.rows.map((row) => ({ ...toRelease(row), appName: row.app_name })),
    total: Number(count.rows[0]?.count),
  };
}

export async function findReleaseById(pool: Pool, id: number): Promise<ApkRelease | undefined> {
  const result = await pool.query<ApkReleaseRow>("SELECT * FROM apk_releases WHERE id = $1", [id]);
  const row = result.rows[0];
  return row === undefined ? undefined : toRelease(row);
}
