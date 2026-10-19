export interface App {
  id: number;
  name: string;
  packageName: string;
  createdAt: string;
  latestRelease: LatestRelease | null;
}

export interface LatestRelease {
  id: number;
  versionName: string;
  versionCode: number;
  fileSize: number;
  sha256: string | null;
  releaseNotes: string | null;
  downloadUrl: string;
  createdAt: string;
}

export interface Release {
  id: number;
  appId: number;
  appName: string;
  versionName: string;
  versionCode: number;
  fileName: string;
  fileSize: number;
  sha256: string | null;
  releaseNotes: string | null;
  createdAt: string;
  downloadUrl: string;
}

export interface Pagination {
  limit: number;
  offset: number;
  total: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
