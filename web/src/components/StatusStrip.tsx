import { formatFileSize } from "../format";

export interface StatusMetrics {
  /** Every release the server holds, not only the ones on screen. */
  releases: number;
  /** The apps that have at least one release. */
  apps: string[];
  /** The size of the releases that are loaded in this page. */
  bytes: number;
  /** The releases in this page. */
  loaded: number;
  /** The build that was uploaded last, as the app list reports it. */
  newest: { appName: string; versionName: string; versionCode: number } | null;
}

interface StatusStripProps {
  metrics: StatusMetrics;
}

/**
 * The status strip. It sits between the hero and the list and answers the questions a release
 * manager asks first: how much is on the server, and what came in last.
 */
export function StatusStrip({ metrics }: StatusStripProps) {
  const appCount = metrics.apps.length;

  return (
    <section className="status" aria-label="Server status">
      <div className="status-cell">
        <p className="status-label">Releases on the server</p>
        <p className="status-figure">{metrics.releases.toLocaleString()}</p>
        <p className="status-caption">
          {appCount === 0
            ? "nothing uploaded yet"
            : `across ${appCount} ${appCount === 1 ? "app" : "apps"}`}
        </p>
      </div>

      <div className="status-cell">
        <p className="status-label">Apps</p>
        <p className="status-figure">{appCount.toLocaleString()}</p>
        <p className="status-caption">
          {appCount === 0
            ? "none with a release"
            : appCount === 1
              ? metrics.apps[0]
              : "each with a release"}
        </p>
      </div>

      <div className="status-cell">
        <p className="status-label">Newest build</p>
        <p className="status-figure status-figure-small">
          {metrics.newest === null ? "—" : metrics.newest.versionName}
        </p>
        <p className="status-caption">
          {metrics.newest === null
            ? "nothing yet"
            : `${metrics.newest.appName} · code ${metrics.newest.versionCode}`}
        </p>
      </div>

      <div className="status-cell">
        <p className="status-label">In this list</p>
        <p className="status-figure status-figure-small">{formatFileSize(metrics.bytes)}</p>
        <p className="status-caption">
          {metrics.loaded} {metrics.loaded === 1 ? "release" : "releases"} loaded
        </p>
      </div>
    </section>
  );
}
