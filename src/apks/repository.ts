import { DatabaseError, type Pool } from "pg";
import { ConflictError } from "../errors.js";

export interface NewApkRelease {
  versionName: string;
  versionCode: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  releaseNotes: string | null;
}

export interface ApkRelease extends NewApkRelease {
  id: number;
  createdAt: Date;
}

interface ApkReleaseRow {
  id: number;
  version_name: string;
  version_code: number;
  file_name: string;
  file_path: string;
  file_size: string;
  release_notes: string | null;
  created_at: Date;
}

const UNIQUE_VIOLATION = "23505";

export async function insertRelease(pool: Pool, release: NewApkRelease): Promise<ApkRelease> {
  try {
    const result = await pool.query<ApkReleaseRow>(
      `INSERT INTO apk_releases
         (version_name, version_code, file_name, file_path, file_size, release_notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        release.versionName,
        release.versionCode,
        release.fileName,
        release.filePath,
        release.fileSize,
        release.releaseNotes,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("insert into apk_releases returned no row");
    }
    return {
      id: row.id,
      versionName: row.version_name,
      versionCode: row.version_code,
      fileName: row.file_name,
      filePath: row.file_path,
      // BIGINT arrives as a string; APK sizes stay far below Number.MAX_SAFE_INTEGER
      fileSize: Number(row.file_size),
      releaseNotes: row.release_notes,
      createdAt: row.created_at,
    };
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
