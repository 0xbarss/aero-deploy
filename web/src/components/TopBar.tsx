/**
 * The wordmark. The server address lives with the copy button in the hero and in the footer, so
 * the bar itself stays quiet.
 */
export function TopBar() {
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
    </header>
  );
}
