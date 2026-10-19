import type { App, ApiResponse, Pagination, Release } from "./types";

const BASE = "/api";

/**
 * The message of the server's error envelope, or a plain line naming the status.
 */
export function apiErrorMessage(status: number, body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body;
    if (typeof error === "object" && error !== null && "message" in error) {
      const { message } = error;
      if (typeof message === "string" && message !== "") {
        return message;
      }
    }
  }
  return `The server answered HTTP ${status}.`;
}

/** The code of the server's error envelope, or null when the body has none. */
export function errorCode(body: unknown): string | null {
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body;
    if (typeof error === "object" && error !== null && "code" in error) {
      return typeof error.code === "string" ? error.code : null;
    }
  }
  return null;
}

/**
 * What to tell the user when the check before a download fails, and whether the release itself
 * is gone (so the list is out of date).
 */
export function downloadFailure(
  status: number,
  body: unknown,
): { message: string; releaseRemoved: boolean } {
  const code = errorCode(body);
  if (status === 404 && code === "apk_file_missing") {
    return {
      message:
        "The file for this release is no longer on the server. Delete the release, then upload the build again.",
      releaseRemoved: false,
    };
  }
  if (status === 404 && code === "release_not_found") {
    return { message: "This release was already removed.", releaseRemoved: true };
  }
  return { message: apiErrorMessage(status, body), releaseRemoved: false };
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json" },
      ...init,
    });
  } catch {
    throw new Error("Cannot reach the server. Check that it is running, then try again.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, body));
  }
  return body as T;
}

export function getApps(): Promise<ApiResponse<App[]>> {
  return fetchJson("/apps");
}

/** The addresses of this machine that a phone on the same network can reach the server on. */
export function getNetwork(): Promise<ApiResponse<{ addresses: string[] }>> {
  return fetchJson("/network");
}

export function getReleases(
  appId: number | null,
  limit: number,
  offset: number,
): Promise<ApiResponse<Release[]> & { pagination: Pagination }> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (appId !== null) params.set("appId", String(appId));
  return fetchJson(`/apks?${params}`);
}

export function deleteRelease(id: number, token: string): Promise<void> {
  return fetchJson(`/apks/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).then(() => undefined);
}

export function renameApp(id: number, name: string, token: string): Promise<ApiResponse<App>> {
  return fetchJson(`/apps/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  });
}

export async function uploadApk(
  file: File,
  releaseNotes: string,
  token: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<ApiResponse<Release>> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("apk", file, file.name);
    if (releaseNotes.trim()) {
      body.append("releaseNotes", releaseNotes.trim());
    }

    const request = new XMLHttpRequest();
    request.open("POST", "/apks/upload");
    request.setRequestHeader("Accept", "application/json");
    if (token) {
      request.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    request.upload.addEventListener("progress", (event) => {
      onProgress(
        event.lengthComputable ? event.loaded : 0,
        event.lengthComputable ? event.total : 0,
      );
    });

    request.addEventListener("load", () => {
      const parsed: unknown = JSON.parse(request.responseText);
      if (request.status >= 200 && request.status < 300) {
        resolve(parsed as ApiResponse<Release>);
        return;
      }
      reject(new Error(apiErrorMessage(request.status, parsed)));
    });

    request.addEventListener("error", () => {
      reject(new Error("Cannot reach the server. Check that it is running, then try again."));
    });

    request.addEventListener("abort", () => {
      reject(new Error("Upload cancelled."));
    });

    request.send(body);
  });
}
