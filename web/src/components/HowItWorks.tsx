/**
 * The three steps a build takes from a Gradle folder to a phone. The text is the server's own
 * behaviour, not a promise.
 */
export function HowItWorks() {
  return (
    <section className="howto" aria-label="How a build reaches a phone">
      <p className="eyebrow">
        <span className="eyebrow-rule" aria-hidden="true" />
        How a build reaches a phone
      </p>

      <div className="howto-grid">
        <article className="howto-step">
          <p className="howto-index">01</p>
          <h3 className="howto-title">The package is read</h3>
          <p className="howto-text">
            The server opens <code>AndroidManifest.xml</code> inside the APK and reads the package
            name, the version name, the version code and the app label out of it. Nobody types those
            in, so the list can't show a version the file doesn't have.
          </p>
        </article>

        <article className="howto-step">
          <p className="howto-index">02</p>
          <h3 className="howto-title">The file is stored</h3>
          <p className="howto-text">
            The upload goes straight to disk as <code>&lt;versionCode&gt;-&lt;uuid&gt;.apk</code>,
            and the SHA-256 is worked out while it arrives. The file on disk, the checksum we show
            and the file a phone downloads are all the same one.
          </p>
        </article>

        <article className="howto-step">
          <p className="howto-index">03</p>
          <h3 className="howto-title">The phone installs it</h3>
          <p className="howto-text">
            Every release gets its own address under <code>/api/apks/download/</code>. Open it on a
            phone on the same network, or scan the QR code, and Android asks to install the package.
          </p>
        </article>
      </div>
    </section>
  );
}
