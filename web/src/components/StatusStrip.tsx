import { formatFileSize } from "../format";

export interface StatusMetrics {
  /** Every release the server holds, not only the ones on screen. */
  releases: number;
  /** Apps the server knows about. */
  apps: number;
  /** Apps that still have at least one release. */
  tracked: number;
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
  return (
    <section className="status" aria-label="Server status">
      <div className="status-cell">
        <p className="status-label">Releases on the server</p>
        <p className="status-figure">{metrics.releases.toLocaleString()}</p>
        <p className="status-caption">
          {metrics.tracked === 0
            ? "nothing uploaded yet"
            : `across ${metrics.tracked} ${metrics.tracked === 1 ? "app" : "apps"}`}
        </p>
      </div>

      <div className="status-cell">
        <p className="status-label">Apps tracked</p>
        <p className="status-figure">{metrics.apps.toLocaleString()}</p>
        <p className="status-caption">
          {metrics.apps === metrics.tracked
            ? "all of them have a release"
            : `${metrics.tracked} with a release left`}
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
