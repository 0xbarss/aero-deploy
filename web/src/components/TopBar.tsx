interface TopBarProps {
  origin: string;
  busy: boolean;
  onRefresh: () => void;
}

/** The wordmark, the address the server answers on, and a way to reload the ledger. */
export function TopBar({ origin, busy, onRefresh }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3 21 19H3L12 3Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M12 12v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <span className="wordmark">AeroDeploy</span>
        <span className="topbar-tag">On your own network</span>
      </div>

      <div className="topbar-right">
        <span
          className="origin-chip"
          title="The address a phone on the same network can use to reach this server"
        >
          <span className="pulse" aria-hidden="true" />
          <span className="origin-text">{origin.replace(/^https?:\/\//, "")}</span>
        </span>
        <button
          type="button"
          className="ghost-button"
          onClick={onRefresh}
          disabled={busy}
          aria-label="Reload the release list"
        >
          {busy ? "Reloading…" : "Reload"}
        </button>
      </div>
    </header>
  );
}
