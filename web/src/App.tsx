import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteRelease, downloadFailure, getApps, getNetwork, getReleases, renameApp } from "./api";
import {
  confirmationNote,
  copyText,
  filterableApps,
  latestReleaseIds,
  probeDownload,
  shareableOrigin,
  successorOf,
} from "./format";
import type { App as AppRecord, Release } from "./types";
import { Footer } from "./components/Footer";
import { HowItWorks } from "./components/HowItWorks";
import { Ledger } from "./components/Ledger";
import { Masthead } from "./components/Masthead";
import { Rail } from "./components/Rail";
import { StatusStrip, type StatusMetrics } from "./components/StatusStrip";
import { TopBar } from "./components/TopBar";
import { UploadSheet } from "./components/UploadSheet";

const PAGE_SIZE = 50;

export interface Notice {
  tone: "ok" | "error";
  text: string;
}

export interface ConfirmState {
  releaseId: number;
  note: string | null;
  error: string | null;
}

export interface RenameState {
  appId: number;
  draft: string;
  error: string | null;
}

export function App() {
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [total, setTotal] = useState(0);
  const [serverTotal, setServerTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appFilter, setAppFilter] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [rename, setRename] = useState<RenameState | null>(null);
  const [downloadProblem, setDownloadProblem] = useState<string | null>(null);

  // The admin token is kept in memory only, so the server asks for it again after a reload.
  const adminToken = useRef<string | null>(null);

  const showNotice = useCallback((next: Notice) => {
    setNotice(next);
  }, []);

  // A notice that reports good news steps aside by itself. An error stays until something else
  // replaces it.
  useEffect(() => {
    if (notice === null || notice.tone === "error") {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const latestIds = useMemo(() => latestReleaseIds(apps), [apps]);

  const loadFirstPage = useCallback(
    async (nextNotice: Notice | null = null, filter: number | null = appFilter) => {
      setLoading(true);
      setLoadError(null);
      try {
        const [appsResponse, everything] = await Promise.all([
          getApps(),
          // The count of every release the server holds, which a filtered list cannot tell.
          getReleases(null, 1, 0).catch(() => null),
        ]);
        setApps(appsResponse.data);
        if (everything !== null) {
          setServerTotal(everything.pagination.total);
        }
        // The addresses tell the dashboard which link a phone can follow.
        void getNetwork()
          .then((network) => setAddresses(network.data.addresses))
          .catch(() => setAddresses([]));
        // The filtered app may have lost its last release.
        if (!filterableApps(appsResponse.data).some((app) => app.id === filter)) {
          filter = null;
          setAppFilter(null);
        }
        const page = await getReleases(filter, PAGE_SIZE, 0);
        setReleases(page.data);
        setTotal(page.pagination.total);
        // The newest build is shown right away, so the panel has something to offer.
        setSelectedId(page.data[0]?.id ?? null);
        setConfirm(null);
        setRename(null);
        setDownloadProblem(null);
        setNotice(nextNotice);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Unknown error.");
        setNotice(null);
      } finally {
        setLoading(false);
      }
    },
    [appFilter],
  );

  // The first load only. Later reloads go through loadFirstPage, which carries the filter.
  const firstLoad = useRef(loadFirstPage);
  useEffect(() => {
    void firstLoad.current(null, null);
  }, []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await getReleases(appFilter, PAGE_SIZE, releases.length);
      // An upload between two requests shifts the offsets, so skip releases already shown.
      const known = new Set(releases.map((release) => release.id));
      setReleases([...releases, ...page.data.filter((release) => !known.has(release.id))]);
      setTotal(page.pagination.total);
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : "Unknown error.");
    } finally {
      setLoadingMore(false);
    }
  }, [appFilter, releases]);

  const selected = useMemo(
    () => releases.find((release) => release.id === selectedId) ?? null,
    [releases, selectedId],
  );

  const select = useCallback((id: number) => {
    setSelectedId(id);
    setConfirm(null);
    setRename(null);
    setDownloadProblem(null);
  }, []);

  const startDownload = useCallback(
    async (release: Release) => {
      setDownloadProblem(null);
      let failure: { message: string; releaseRemoved: boolean } | null = null;
      try {
        const result = await probeDownload(release.downloadUrl);
        if (!result.ok) {
          failure = downloadFailure(result.status, result.body);
        }
      } catch (error) {
        failure = {
          message: error instanceof Error ? error.message : "Unknown error.",
          releaseRemoved: false,
        };
      }
      if (failure === null) {
        window.location.assign(release.downloadUrl);
        return;
      }
      if (failure.releaseRemoved) {
        // The list is out of date, so it is loaded again.
        showNotice({
          tone: "error",
          text: `${release.appName} ${release.versionName} was removed.`,
        });
        await loadFirstPage();
        return;
      }
      setDownloadProblem(failure.message);
    },
    [loadFirstPage, showNotice],
  );

  const openConfirm = useCallback(
    async (release: Release) => {
      let successor: Release | null = null;
      const isLatest = latestIds.has(release.id);
      if (isLatest) {
        try {
          const page = await getReleases(release.appId, 2, 0);
          successor = successorOf(release.id, page.data);
        } catch (error) {
          setNotice({
            tone: "error",
            text: error instanceof Error ? error.message : "Unknown error.",
          });
          return;
        }
      }
      setRename(null);
      setConfirm({
        releaseId: release.id,
        note: confirmationNote(release.appName, isLatest, successor),
        error: null,
      });
    },
    [latestIds],
  );

  const status = useMemo<StatusMetrics>(() => {
    const bytes = releases.reduce((sum, release) => sum + release.fileSize, 0);
    // The newest build is the one that was uploaded last, which is not always the one with the
    // highest version code.
    let newest: {
      appName: string;
      versionName: string;
      versionCode: number;
      createdAt: string;
    } | null = null;
    for (const app of apps) {
      const release = app.latestRelease;
      if (release === null) {
        continue;
      }
      if (newest === null || new Date(release.createdAt) > new Date(newest.createdAt)) {
        newest = {
          appName: app.name,
          versionName: release.versionName,
          versionCode: release.versionCode,
          createdAt: release.createdAt,
        };
      }
    }
    return {
      releases: serverTotal,
      apps: apps.length,
      tracked: filterableApps(apps).length,
      bytes,
      loaded: releases.length,
      newest,
    };
  }, [apps, releases, serverTotal]);

  // The address a phone on the same network can use to reach this server.
  const shareable = useMemo(() => shareableOrigin(window.location.origin, addresses), [addresses]);

  return (
    <div className="shell">
      <TopBar origin={shareable} busy={loading} onRefresh={() => void loadFirstPage()} />

      <div className="hero-band">
        <Masthead
          releases={releases}
          apps={apps}
          addresses={addresses}
          latestIds={latestIds}
          selectedId={selectedId}
          downloadProblem={downloadProblem}
          onSelect={select}
          onDownload={(release) => void startDownload(release)}
          onUpload={() => setUploadOpen(true)}
          onCopyOrigin={async () => {
            const copied = await copyText(shareable);
            showNotice(
              copied
                ? {
                    tone: "ok",
                    text: `${shareable.replace(/^https?:\/\//, "")} copied. Open it on a phone on the same network.`,
                  }
                : { tone: "error", text: "Could not copy the address." },
            );
          }}
          onNotice={showNotice}
        />

        <StatusStrip metrics={status} />
      </div>

      <div className="workspace">
        <div className="workspace-main">
          {loadError !== null ? (
            <section className="panel panel-empty">
              <h2>The releases could not be loaded</h2>
              <p className="error-text">{loadError}</p>
              <button type="button" className="button" onClick={() => void loadFirstPage()}>
                Try again
              </button>
            </section>
          ) : (
            <Ledger
              apps={apps}
              releases={releases}
              total={total}
              loading={loading}
              loadingMore={loadingMore}
              loadMoreError={loadMoreError}
              appFilter={appFilter}
              latestIds={latestIds}
              selectedId={selectedId}
              onSelect={select}
              onFilterChange={(value) => {
                setAppFilter(value);
                void loadFirstPage(null, value);
              }}
              onLoadMore={() => void loadMore()}
              onUpload={() => setUploadOpen(true)}
              onDownload={(release) => void startDownload(release)}
            />
          )}
        </div>

        <Rail
          release={selected}
          latestIds={latestIds}
          confirm={confirm}
          rename={rename}
          adminToken={adminToken}
          onOpenConfirm={(release) => void openConfirm(release)}
          onCancelConfirm={() => setConfirm(null)}
          onConfirmDelete={(release, token) => deleteRelease(release.id, token)}
          onOpenRename={(release) => {
            setConfirm(null);
            setRename({ appId: release.appId, draft: release.appName, error: null });
          }}
          onCancelRename={() => setRename(null)}
          onRename={(appId, name, token) => renameApp(appId, name, token).then((r) => r.data)}
          onTokenAccepted={(token) => {
            adminToken.current = token;
          }}
          onRenamed={(appId, name) => {
            setApps((current) => current.map((app) => (app.id === appId ? { ...app, name } : app)));
            setReleases((current) =>
              current.map((release) =>
                release.appId === appId ? { ...release, appName: name } : release,
              ),
            );
          }}
          onNotice={showNotice}
        />
      </div>

      <HowItWorks />

      <Footer origin={shareable} onNotice={showNotice} />

      <UploadSheet
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={async (message) => {
          setUploadOpen(false);
          showNotice({ tone: "ok", text: message });
          await loadFirstPage();
        }}
      />

      <p
        className={`toast ${notice === null ? "toast-idle" : `toast-${notice.tone}`}`}
        role="status"
        aria-live="polite"
      >
        <span className="toast-dot" aria-hidden="true" />
        <span className="toast-text">{notice?.text ?? ""}</span>
      </p>
    </div>
  );
}
