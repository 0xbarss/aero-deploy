import { useMemo, useState } from "react";
import {
  copyText,
  deskTargets,
  formatFileSize,
  formatRelative,
  installCommand,
  installHost,
  phoneUrl,
  pickDeskTarget,
  shortHash,
} from "../format";
import { qrDrawing } from "../qr";
import type { App as AppRecord, Release } from "../types";
import type { Notice } from "../App";
import { CheckIcon, CopyIcon, DownloadIcon, UploadIcon } from "./icons";

interface InstallDeskProps {
  releases: Release[];
  apps: AppRecord[];
  addresses: string[];
  latestIds: Set<number>;
  /** The release the ledger has selected. The desk shows it. */
  selectedId: number | null;
  downloadProblem: string | null;
  onSelect: (id: number) => void;
  onDownload: (release: Release) => void;
  onUpload: () => void;
  onNotice: (notice: Notice) => void;
}

/**
 * The install desk. It is the working part of the hero: it shows the build that is selected and
 * hands out the link, the QR code and the facts the server read out of the package. Everything in
 * it comes from the server, so nothing here is a picture of the product.
 */
export function InstallDesk({
  releases,
  apps,
  addresses,
  latestIds,
  selectedId,
  downloadProblem,
  onSelect,
  onDownload,
  onUpload,
  onNotice,
}: InstallDeskProps) {
  const [copied, setCopied] = useState<"link" | "command" | null>(null);

  // The chips are shortcuts to the builds at the top of the ledger.
  const targets = useMemo(() => deskTargets(releases), [releases]);

  // The desk follows the ledger, so the panel and the install desk always speak about the same
  // build. A release that is not one of the shortcuts is still shown.
  const selected = useMemo(() => {
    const picked = releases.find((release) => release.id === selectedId);
    return picked ?? pickDeskTarget(targets, null);
  }, [releases, selectedId, targets]);

  const packageName = useMemo(() => {
    if (selected === null) {
      return null;
    }
    return apps.find((app) => app.id === selected.appId)?.packageName ?? null;
  }, [apps, selected]);

  // The link a phone on the same network can follow.
  const install = useMemo(
    () => (selected === null ? null : phoneUrl(selected.downloadUrl, addresses)),
    [selected, addresses],
  );

  const host = useMemo(() => (install === null ? null : installHost(install.url)), [install]);

  const qr = useMemo(() => {
    if (install === null) {
      return null;
    }
    try {
      return qrDrawing(install.url);
    } catch (error) {
      // The link is too long for any QR code.
      if (!(error instanceof RangeError)) {
        throw error;
      }
      return null;
    }
  }, [install]);

  const command = install === null ? null : installCommand(install.url);

  async function copy(kind: "link" | "command", text: string) {
    const done = await copyText(text);
    setCopied(done ? kind : null);
    onNotice(
      done
        ? {
            tone: "ok",
            text: kind === "link" ? "Install link copied." : "Download command copied.",
          }
        : { tone: "error", text: "Could not copy to the clipboard." },
    );
    if (done) {
      window.setTimeout(() => setCopied(null), 1800);
    }
  }

  return (
    <section className="desk" aria-label="Install desk">
      <header className="desk-head">
        <h2 className="desk-title">Install a build</h2>
        <p className="desk-sub">Pick one and get the link a phone can open.</p>
      </header>

      {selected === null || install === null ? (
        <div className="desk-empty">
          <p className="desk-empty-title">Nothing uploaded yet</p>
          <p className="muted-text">
            Upload an APK and this panel turns into the link and the QR code for it.
          </p>
          <button type="button" className="button button-primary" onClick={onUpload}>
            <UploadIcon className="icon" />
            Upload a release
          </button>
        </div>
      ) : (
        <>
          <div className="desk-targets" role="group" aria-label="Build to install">
            {targets.map((release) => (
              <button
                key={release.id}
                type="button"
                className="chip"
                aria-pressed={release.id === selected.id}
                onClick={() => onSelect(release.id)}
              >
                <span className="chip-app">{release.appName}</span>
                <span className="chip-version">{release.versionName}</span>
                {latestIds.has(release.id) && <span className="chip-dot" aria-hidden="true" />}
              </button>
            ))}
          </div>

          <div className="desk-body">
            <div className="desk-qr">
              {qr === null ? (
                <p className="muted-text">
                  The link is too long to draw as a QR code. Use the link below instead.
                </p>
              ) : (
                <div className="qr-frame">
                  <svg
                    className="qr"
                    viewBox={`0 0 ${qr.side} ${qr.side}`}
                    role="img"
                    aria-label={`QR code for the ${selected.appName} ${selected.versionName} install link`}
                    shapeRendering="crispEdges"
                  >
                    <rect width={qr.side} height={qr.side} fill="#ffffff" />
                    <path d={qr.path} fill="#000000" />
                  </svg>
                </div>
              )}
              <p className="desk-caption">Scan it with a phone on the same network.</p>
            </div>

            <dl className="desk-facts">
              <div className="desk-fact">
                <dt>Package</dt>
                <dd className="mono" title={packageName ?? undefined}>
                  {packageName ?? "not read"}
                </dd>
              </div>
              <div className="desk-fact">
                <dt>Version</dt>
                <dd className="mono">
                  {selected.versionName} ({selected.versionCode})
                </dd>
              </div>
              <div className="desk-fact">
                <dt>Size</dt>
                <dd className="mono">{formatFileSize(selected.fileSize)}</dd>
              </div>
              <div className="desk-fact">
                <dt>SHA-256</dt>
                <dd className="mono" title={selected.sha256 ?? undefined}>
                  {shortHash(selected.sha256) ?? "not recorded"}
                </dd>
              </div>
              <div className="desk-fact">
                <dt>Uploaded</dt>
                <dd>{formatRelative(selected.createdAt)}</dd>
              </div>
              <div className="desk-fact">
                <dt>File</dt>
                <dd className="mono desk-fact-file" title={selected.fileName}>
                  {selected.fileName}
                </dd>
              </div>
            </dl>
          </div>

          <div className="desk-link">
            <span className="desk-label">Install link</span>
            <div className="link-field">
              <input
                type="text"
                readOnly
                value={install.url}
                aria-label="Install link"
                onFocus={(event) => event.target.select()}
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => void copy("link", install.url)}
                aria-label="Copy the install link"
              >
                {copied === "link" ? <CheckIcon className="icon" /> : <CopyIcon className="icon" />}
              </button>
            </div>
            {install.rewritten && host !== null && (
              <p className="muted-text desk-note">
                Phones on this network can reach <span className="mono">{host}</span>.
              </p>
            )}
          </div>

          <div className="desk-command">
            <div className="desk-command-box">
              <code className="desk-command-text">{command}</code>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => void copy("command", command ?? "")}
              aria-label="Copy the download command"
            >
              {copied === "command" ? (
                <CheckIcon className="icon" />
              ) : (
                <CopyIcon className="icon" />
              )}
            </button>
          </div>

          <div className="desk-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => onDownload(selected)}
            >
              <DownloadIcon className="icon" />
              Download APK
            </button>
            {downloadProblem !== null && (
              <p className="error-text desk-note" role="alert">
                {downloadProblem}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
