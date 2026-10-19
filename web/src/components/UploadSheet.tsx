import { useEffect, useRef, useState } from "react";
import { uploadApk } from "../api";
import { formatFileSize, isApkFileName, progressLabel, uploadSummary } from "../format";
import { CloseIcon, UploadIcon } from "./icons";

interface UploadSheetProps {
  open: boolean;
  onClose: () => void;
  onUploaded: (message: string) => void | Promise<void>;
}

/**
 * The upload sheet. The server reads the version out of the package, so the only thing worth
 * asking for is a note — and the token, but only once the server has refused the upload.
 */
export function UploadSheet({ open, onClose, onUploaded }: UploadSheetProps) {
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [token, setToken] = useState("");
  const [needsToken, setNeedsToken] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (open) {
      fileInput.current?.focus();
    } else {
      // Reset for the next time the sheet opens.
      setFile(null);
      setNotes("");
      setToken("");
      setNeedsToken(false);
      setError(null);
      setSent({ loaded: 0, total: 0 });
      setBusy(false);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  function choose(candidate: File | undefined) {
    setError(null);
    if (candidate === undefined) {
      return;
    }
    if (!isApkFileName(candidate.name)) {
      setError("Choose an .apk file.");
      return;
    }
    setFile(candidate);
  }

  async function submit() {
    if (file === null || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setSent({ loaded: 0, total: 0 });
    try {
      const response = await uploadApk(file, notes, needsToken ? token : "", (loaded, total) => {
        setSent({ loaded, total });
      });
      const data = response.data;
      await onUploaded(uploadSummary(data));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Unknown error.";
      setError(message);
      if (
        message.toLowerCase().includes("token") ||
        message.toLowerCase().includes("unauthorized")
      ) {
        // A wrong token is dropped, so the form asks for it again.
        setNeedsToken(true);
        setToken("");
      }
      setBusy(false);
    }
  }

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        ref={dialog}
      >
        <div className="sheet-head">
          <h2 id="sheet-title">Upload an APK</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close the upload sheet"
          >
            <CloseIcon className="icon" />
          </button>
        </div>

        <p className="muted-text">
          We read the version straight out of the package, so what the list shows always matches the
          file you dropped. The APK is stored in the server's upload folder.
        </p>

        <label
          className={`drop ${dragging ? "is-dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files;
            if (dropped.length > 1) {
              setError("Drop one APK at a time.");
              return;
            }
            choose(dropped[0]);
          }}
        >
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            accept=".apk,application/vnd.android.package-archive"
            onChange={(event) => {
              choose(event.target.files?.[0]);
              // Lets the same file be chosen again after a failed upload.
              event.target.value = "";
            }}
          />
          <UploadIcon className="icon drop-icon" />
          {file === null ? (
            <span className="drop-text">
              Drop an APK here, or <span className="drop-link">choose a file</span>
            </span>
          ) : (
            <span className="drop-text">
              {file.name}
              <span className="drop-size">{formatFileSize(file.size)}</span>
            </span>
          )}
        </label>

        <div className="field">
          <label htmlFor="release-notes">Release notes (optional)</label>
          <textarea
            id="release-notes"
            rows={2}
            autoComplete="off"
            value={notes}
            disabled={busy}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        {needsToken && (
          <div className="field">
            <label htmlFor="upload-token">Upload token (the admin token also works)</label>
            <input
              id="upload-token"
              type="password"
              autoComplete="new-password"
              value={token}
              disabled={busy}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
        )}

        {busy && (
          <>
            <progress
              className="progress"
              max={sent.total > 0 ? sent.total : 1}
              value={sent.loaded}
              aria-label="Upload progress"
            />
            <p className="muted-text progress-label">{progressLabel(sent.loaded, sent.total)}</p>
          </>
        )}

        {error !== null && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <div className="sheet-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void submit()}
            disabled={file === null || busy}
          >
            <UploadIcon className="icon" />
            {busy ? "Uploading…" : "Upload"}
          </button>
          <button type="button" className="button button-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
