import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { App as AppRecord, Release } from "../types";
import {
  copyText,
  formatFileSize,
  formatTimestamp,
  isRenameChange,
  matchesVersionName,
} from "../format";
import type { ConfirmState, Notice, RenameState } from "../App";
import { PencilIcon, TrashIcon } from "./icons";

interface RailProps {
  release: Release | null;
  latestIds: Set<number>;
  confirm: ConfirmState | null;
  rename: RenameState | null;
  adminToken: RefObject<string | null>;
  onOpenConfirm: (release: Release) => void;
  onCancelConfirm: () => void;
  onConfirmDelete: (release: Release, token: string) => Promise<void>;
  onOpenRename: (release: Release) => void;
  onCancelRename: () => void;
  onRename: (appId: number, name: string, token: string) => Promise<AppRecord>;
  onTokenAccepted: (token: string) => void;
  onRenamed: (appId: number, name: string) => void;
  onNotice: (notice: Notice) => void;
}

/**
 * The rail beside the ledger. It holds what is known about one release and what can be done with
 * it: its checksum, its notes, the name of the app it belongs to and the removal of the release.
 * The link and the QR code for the same release live in the install desk, so they are not repeated
 * here.
 */
export function Rail({
  release,
  latestIds,
  confirm,
  rename,
  adminToken,
  onOpenConfirm,
  onCancelConfirm,
  onConfirmDelete,
  onOpenRename,
  onCancelRename,
  onRename,
  onTokenAccepted,
  onRenamed,
  onNotice,
}: RailProps) {
  return (
    <aside className="rail" aria-label="Release details">
      {release === null ? (
        <div className="rail-empty">
          <p className="eyebrow">
            <span className="eyebrow-rule" aria-hidden="true" />
            No selection
          </p>
          <p className="rail-empty-text">
            Pick a release in the list to see its notes, its checksum and what you can do with it.
          </p>
        </div>
      ) : (
        <RailContent
          key={release.id}
          release={release}
          isLatest={latestIds.has(release.id)}
          confirm={confirm}
          rename={rename}
          adminToken={adminToken}
          onOpenConfirm={onOpenConfirm}
          onCancelConfirm={onCancelConfirm}
          onConfirmDelete={onConfirmDelete}
          onOpenRename={onOpenRename}
          onCancelRename={onCancelRename}
          onRename={onRename}
          onTokenAccepted={onTokenAccepted}
          onRenamed={onRenamed}
          onNotice={onNotice}
        />
      )}
    </aside>
  );
}

interface RailContentProps extends Omit<RailProps, "release" | "latestIds"> {
  release: Release;
  isLatest: boolean;
}

function RailContent({
  release,
  isLatest,
  confirm,
  rename,
  adminToken,
  onOpenConfirm,
  onCancelConfirm,
  onConfirmDelete,
  onOpenRename,
  onCancelRename,
  onRename,
  onTokenAccepted,
  onRenamed,
  onNotice,
}: RailContentProps) {
  const [copied, setCopied] = useState(false);
  const [typedVersion, setTypedVersion] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState(rename?.draft ?? release.appName);
  const renameInput = useRef<HTMLInputElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const needsToken = adminToken.current === null;

  useEffect(() => {
    if (confirm !== null && confirm.releaseId === release.id) {
      versionInput.current?.focus();
    }
  }, [confirm, release.id]);

  useEffect(() => {
    if (rename !== null && rename.appId === release.appId) {
      renameInput.current?.focus();
      renameInput.current?.select();
    }
  }, [rename, release.appId]);

  async function copyHash() {
    const done = await copyText(release.sha256 ?? "");
    setCopied(done);
    onNotice(
      done
        ? { tone: "ok", text: "Checksum copied." }
        : { tone: "error", text: "Could not copy to the clipboard." },
    );
    if (done) {
      window.setTimeout(() => setCopied(false), 1800);
    }
  }

  async function runDelete(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !matchesVersionName(typedVersion, release.versionName)) {
      return;
    }
    const bearer = adminToken.current ?? token;
    if (bearer === "") {
      setFormError("Enter the admin token to delete a release.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await onConfirmDelete(release, bearer);
      onTokenAccepted(bearer);
      onNotice({ tone: "ok", text: `Deleted ${release.appName} ${release.versionName}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setFormError(message);
      // A wrong token is dropped, so the form asks for it again.
      if (
        message.toLowerCase().includes("token") ||
        message.toLowerCase().includes("unauthorized")
      ) {
        adminToken.current = null;
        setToken("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function runRename(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !isRenameChange(name, release.appName)) {
      return;
    }
    const bearer = adminToken.current ?? token;
    if (bearer === "") {
      setFormError("Enter the admin token to rename an app.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const renamed = await onRename(release.appId, name.trim(), bearer);
      onTokenAccepted(bearer);
      onRenamed(renamed.id, renamed.name);
      onNotice({ tone: "ok", text: `Renamed ${release.appName} to ${renamed.name}.` });
      onCancelRename();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setFormError(message);
      if (
        message.toLowerCase().includes("token") ||
        message.toLowerCase().includes("unauthorized")
      ) {
        adminToken.current = null;
        setToken("");
      }
    } finally {
      setBusy(false);
    }
  }

  const notes = useMemo(() => release.releaseNotes ?? "", [release.releaseNotes]);

  return (
    <>
      <div className="rail-body">
        <p className="eyebrow">
          <span className="eyebrow-rule" aria-hidden="true" />
          Selected release
        </p>

        <h2 className="rail-title">
          {release.appName}
          <span className="rail-version">{release.versionName}</span>
          {isLatest && <span className="badge">Latest</span>}
        </h2>

        <p className="meta-line">
          <span className="mono">{release.versionCode}</span>
          <span aria-hidden="true"> · </span>
          {formatFileSize(release.fileSize)}
          <span aria-hidden="true"> · </span>
          {formatTimestamp(release.createdAt)}
        </p>
        <p className="meta-file mono">{release.fileName}</p>

        {notes !== "" && (
          <section className="rail-section">
            <h3 className="rail-heading">Release notes</h3>
            <p className="notes">{notes}</p>
          </section>
        )}
      </div>
      {/* The details and the actions sit together at the foot of the panel. */}
      <div className="rail-footer">
        {release.sha256 === null ? (
          <div className="rail-row">
            <span className="rail-row-label">SHA-256</span>
            <span className="rail-row-value">Not recorded</span>
          </div>
        ) : (
          <div className="rail-row">
            <span className="rail-row-label">SHA-256</span>
            <span className="rail-row-value mono" title={release.sha256}>
              {release.sha256}
            </span>
            <button type="button" className="text-button" onClick={() => void copyHash()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}

        <div className="rail-row">
          <span className="rail-row-label">App</span>
          {rename !== null && rename.appId === release.appId ? (
            <form className="form rail-form" onSubmit={(event) => void runRename(event)}>
              <label htmlFor="rename-name">App name</label>
              <input
                id="rename-name"
                ref={renameInput}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {needsToken && (
                <>
                  <label htmlFor="rename-token">Admin token</label>
                  <input
                    id="rename-token"
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                </>
              )}
              {formError !== null && (
                <p className="error-text" role="alert">
                  {formError}
                </p>
              )}
              <div className="form-actions">
                <button type="submit" className="button button-primary" disabled={busy}>
                  {busy ? "Saving…" : "Save name"}
                </button>
                <button type="button" className="button button-ghost" onClick={onCancelRename}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <span className="rail-row-value" title={release.appName}>
                {release.appName}
              </span>
              <button type="button" className="text-button" onClick={() => onOpenRename(release)}>
                <PencilIcon className="icon" />
                Rename
              </button>
            </>
          )}
        </div>

        <div className="rail-row">
          <span className="rail-row-label">Remove</span>
          {confirm !== null && confirm.releaseId === release.id ? (
            <form className="form rail-form" onSubmit={(event) => void runDelete(event)}>
              <p className="muted-text">
                This removes the release and its file from the server. Phones that already installed
                it keep it.
              </p>
              {confirm.note !== null && <p className="muted-text">{confirm.note}</p>}
              <label htmlFor="confirm-version">Type {release.versionName} to confirm</label>
              <input
                id="confirm-version"
                ref={versionInput}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={typedVersion}
                onChange={(event) => setTypedVersion(event.target.value)}
              />
              {needsToken && (
                <>
                  <label htmlFor="delete-token">Admin token</label>
                  <input
                    id="delete-token"
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                </>
              )}
              {formError !== null && (
                <p className="error-text" role="alert">
                  {formError}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="submit"
                  className="button button-danger"
                  disabled={busy || !matchesVersionName(typedVersion, release.versionName)}
                >
                  {busy ? "Deleting…" : "Delete release"}
                </button>
                <button type="button" className="button button-ghost" onClick={onCancelConfirm}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <span className="rail-row-value">This release</span>
              <button
                type="button"
                className="text-button danger-text"
                onClick={() => onOpenConfirm(release)}
              >
                <TrashIcon className="icon" />
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
