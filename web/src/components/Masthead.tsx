import { InstallDesk } from "./InstallDesk";
import { CheckIcon, CopyIcon, UploadIcon } from "./icons";
import type { App as AppRecord, Release } from "../types";
import type { Notice } from "../App";

interface MastheadProps {
  releases: Release[];
  apps: AppRecord[];
  addresses: string[];
  latestIds: Set<number>;
  selectedId: number | null;
  downloadProblem: string | null;
  onSelect: (id: number) => void;
  onDownload: (release: Release) => void;
  onUpload: () => void;
  onCopyOrigin: () => void | Promise<void>;
  onNotice: (notice: Notice) => void;
}

/**
 * The masthead. The headline sits on a left reading axis and the install desk stands beside it, so
 * the page never reads as a centred column of stacked marketing pieces. The desk is a working part
 * of the product: it hands out the link, the QR code and the facts of a real build.
 */
export function Masthead({
  releases,
  apps,
  addresses,
  latestIds,
  selectedId,
  downloadProblem,
  onSelect,
  onDownload,
  onUpload,
  onCopyOrigin,
  onNotice,
}: MastheadProps) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">
          <span className="eyebrow-rule" aria-hidden="true" />
          Deploy target
        </p>
        <h1>
          Ship the build.
          <br />
          <span className="hero-soft">Tap to install.</span>
        </h1>
        <p className="lede">
          AeroDeploy keeps your APKs on your own network. Upload one, then open the link on any
          phone that's on the same Wi-Fi. No store, no account, no public URL. The version comes out
          of the package itself, so the list can never disagree with the file.
        </p>

        <div className="masthead-actions">
          <button type="button" className="button button-primary" onClick={onUpload}>
            <UploadIcon className="icon" />
            Upload a release
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              void onCopyOrigin();
            }}
          >
            <CopyIcon className="icon" />
            Copy server address
          </button>
        </div>

        <ul className="factline">
          <li>
            <CheckIcon className="icon" />
            The version comes from the APK, not from a form
          </li>
          <li>
            <CheckIcon className="icon" />
            SHA-256 for every upload
          </li>
          <li>
            <CheckIcon className="icon" />A QR code for phones on the same network
          </li>
        </ul>
      </div>

      <InstallDesk
        releases={releases}
        apps={apps}
        addresses={addresses}
        latestIds={latestIds}
        selectedId={selectedId}
        downloadProblem={downloadProblem}
        onSelect={onSelect}
        onDownload={onDownload}
        onUpload={onUpload}
        onNotice={onNotice}
      />
    </section>
  );
}
