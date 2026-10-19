const UNREACHABLE = "Cannot reach the server. Check that it is running, then try again.";

/**
 * Asks the server for the file and drops the answer as soon as the headers arrive, so a missing
 * file can be reported before the browser starts a download. It uses GET because the server
 * keeps the file open for a few seconds after a HEAD request.
 * @param {string} url
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{ ok: true } | { ok: false, status: number, body: unknown }>}
 */
export async function probeDownload(url, fetchFn = fetch) {
  let response;
  try {
    response = await fetchFn(url, { method: "GET" });
  } catch (error) {
    throw new Error(UNREACHABLE, { cause: error });
  }
  if (response.ok) {
    await response.body?.cancel();
    return { ok: true };
  }
  const body = await response.json().catch(() => null);
  return { ok: false, status: response.status, body };
}
