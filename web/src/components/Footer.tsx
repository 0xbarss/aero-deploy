import { useState } from "react";
import { copyText } from "../format";
import type { Notice } from "../App";
import { CheckIcon, CopyIcon } from "./icons";

interface FooterProps {
  /** The address a phone on the same network can reach the server on. */
  origin: string;
  onNotice: (notice: Notice) => void;
}

const ENDPOINTS = [
  ["GET", "/api/health"],
  ["GET", "/api/apks"],
  ["GET", "/api/apks/latest"],
  ["GET", "/api/apks/download/:id"],
  ["GET", "/api/network"],
  ["POST", "/api/apks/upload"],
] as const;

const BUILD_COMMAND = 'npm run upload -- app-debug.apk --notes "Nightly build"';

/**
 * The footer. It holds the parts of the product a reader wants after the ledger: the addresses the
 * server answers on, the endpoints behind the page and the command a build step runs.
 */
export function Footer({ origin, onNotice }: FooterProps) {
  const [copied, setCopied] = useState<"address" | "command" | null>(null);

  async function copy(kind: "address" | "command", text: string) {
    const done = await copyText(text);
    setCopied(done ? kind : null);
    onNotice(
      done
        ? { tone: "ok", text: "Copied to the clipboard." }
        : { tone: "error", text: "Could not copy to the clipboard." },
    );
    if (done) {
      window.setTimeout(() => setCopied(null), 1800);
    }
  }

  return (
    <footer className="footer">
      <div className="footer-grid">
        <div className="footer-col">
          <p className="footer-col-title">AeroDeploy</p>
          <p className="footer-text">
            Everything stays on your own network: the server, the files and the list of builds. No
            account, no public address, nothing sent anywhere else.
          </p>
          <div className="footer-address">
            <span className="footer-label">Open this address on a phone</span>
            <div className="link-field">
              <input type="text" readOnly value={origin} aria-label="Server address" />
              <button
                type="button"
                className="icon-button"
                onClick={() => void copy("address", origin)}
                aria-label="Copy the server address"
              >
                {copied === "address" ? (
                  <CheckIcon className="icon" />
                ) : (
                  <CopyIcon className="icon" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="footer-col">
          <p className="footer-col-title">Endpoints</p>
          <ul className="footer-list">
            {ENDPOINTS.map(([method, path]) => (
              <li key={`${method} ${path}`} className="footer-endpoint">
                <span className="footer-method">{method}</span>
                <span className="mono">{path}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="footer-col">
          <p className="footer-col-title">From your build script</p>
          <p className="footer-text">
            The upload script sends the APK and fails your build if the server won't take it.
          </p>
          <div className="footer-command">
            <code className="footer-command-text">{BUILD_COMMAND}</code>
            <button
              type="button"
              className="text-button"
              onClick={() => void copy("command", BUILD_COMMAND)}
            >
              {copied === "command" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      <div className="footer-base">
        <span>AeroDeploy · MIT licence</span>
        <span>Fastify · PostgreSQL · React</span>
        <span>The page and the API are the same process</span>
      </div>
    </footer>
  );
}
