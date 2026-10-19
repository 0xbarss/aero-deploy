import { useMemo, useState } from "react";
import { filterableApps, formatDay, formatFileSize, formatRelative, shortHash } from "../format";
import type { App as AppRecord, Release } from "../types";
import { DownloadIcon, SearchIcon, UploadIcon } from "./icons";

interface LedgerProps {
  apps: AppRecord[];
  releases: Release[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  loadMoreError: string | null;
  appFilter: number | null;
  latestIds: Set<number>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onFilterChange: (appId: number | null) => void;
  onLoadMore: () => void;
  onUpload: () => void;
  onDownload: (release: Release) => void;
}

/** The release ledger: the table of everything the server holds. */
export function Ledger({
  apps,
  releases,
  total,
  loading,
  loadingMore,
  loadMoreError,
  appFilter,
  latestIds,
  selectedId,
  onSelect,
  onFilterChange,
  onLoadMore,
  onUpload,
  onDownload,
}: LedgerProps) {
  const [query, setQuery] = useState("");

  const filterable = useMemo(() => filterableApps(apps), [apps]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      return releases;
    }
    return releases.filter((release) =>
      [release.appName, release.versionName, release.fileName, release.releaseNotes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [releases, query]);

  if (loading && releases.length === 0) {
    return (
      <section className="panel panel-empty" aria-busy="true">
        <p className="muted-text">Loading the releases…</p>
      </section>
    );
  }

  if (releases.length === 0) {
    return (
      <section className="panel panel-empty">
        <h2>Nothing uploaded yet</h2>
        <p className="muted-text">
          Upload an APK from this page, or run <code>npm run upload</code> on the server. It'll show
          up here as soon as the file lands.
        </p>
        <button type="button" className="button button-primary" onClick={onUpload}>
          <UploadIcon className="icon" />
          Upload a release
        </button>
      </section>
    );
  }

  return (
    <section className="ledger" aria-label="Releases">
      <div className="ledger-toolbar">
        <div className="search">
          <SearchIcon className="icon search-icon" />
          <input
            type="search"
            value={query}
            placeholder="Filter by app, version or notes"
            aria-label="Filter releases"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {filterable.length >= 2 && (
          <div className="select-wrap">
            <label htmlFor="app-filter">App</label>
            <select
              id="app-filter"
              value={appFilter === null ? "" : String(appFilter)}
              onChange={(event) =>
                onFilterChange(event.target.value === "" ? null : Number(event.target.value))
              }
            >
              <option value="">All apps</option>
              {filterable.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="ledger-count">
          {query.trim() === "" ? (
            <>
              <strong>{visible.length}</strong> of {total} releases
            </>
          ) : (
            <>
              <strong>{visible.length}</strong> match “{query.trim()}”
            </>
          )}
        </p>
      </div>

      <div className="table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th scope="col" className="col-app">
                App
              </th>
              <th scope="col">Version</th>
              <th scope="col" className="col-code">
                Code
              </th>
              <th scope="col" className="col-date">
                Uploaded
              </th>
              <th scope="col" className="col-size">
                Size
              </th>
              <th scope="col" className="col-hash">
                SHA-256
              </th>
              <th scope="col" className="col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((release) => {
              const selected = release.id === selectedId;
              const hash = shortHash(release.sha256);
              return (
                <tr
                  key={release.id}
                  className={selected ? "is-selected" : undefined}
                  aria-current={selected ? "true" : undefined}
                >
                  <td className="col-app">
                    <span className="cell-app" title={release.appName}>
                      {release.appName}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="pick"
                      aria-current={selected ? "true" : "false"}
                      onClick={() => onSelect(release.id)}
                    >
                      {release.versionName}
                    </button>
                    {latestIds.has(release.id) && <span className="badge">Latest</span>}
                  </td>
                  <td className="mono col-code">{release.versionCode}</td>
                  <td className="col-date">
                    <span title={formatDay(release.createdAt)}>
                      {formatRelative(release.createdAt)}
                    </span>
                  </td>
                  <td className="mono col-size">{formatFileSize(release.fileSize)}</td>
                  <td
                    className="mono col-hash"
                    title={hash === null ? "No checksum recorded" : undefined}
                  >
                    {hash ?? "—"}
                  </td>
                  <td className="col-actions">
                    <a
                      className="row-download"
                      href={release.downloadUrl}
                      download
                      onClick={(event) => {
                        // The link keeps its address for "save link as", but a plain click is checked
                        // first, so a missing file gives a message instead of a saved error page.
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                          return;
                        }
                        event.preventDefault();
                        onSelect(release.id);
                        onDownload(release);
                      }}
                      aria-label={`Download ${release.appName} ${release.versionName}`}
                    >
                      <DownloadIcon className="icon" />
                      <span className="row-download-text">APK</span>
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 && <p className="ledger-no-match">No release matches that filter.</p>}
      </div>

      <div className="ledger-footer">
        <p className="muted-text">
          Showing {visible.length} of {total} releases
        </p>
        {visible.length < total && (
          <button
            type="button"
            className="button button-ghost"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
        {loadMoreError !== null && <p className="error-text">{loadMoreError}</p>}
      </div>
    </section>
  );
}
