import { apiErrorMessage, formatFileSize, latestReleaseIds, shortHash } from "./release-view.js";

const PAGE_SIZE = 50;
const FEEDBACK_MS = 1800;

const root = document.getElementById("app");
const announcer = document.getElementById("announce");
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const state = {
  releases: [],
  total: 0,
  latestIds: new Set(),
  selectedId: null,
  loadingMore: false,
  loadMoreError: null,
};

function h(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) {
      continue;
    }
    if (name === "class") {
      node.className = value;
    } else if (name.startsWith("on")) {
      node.addEventListener(name.slice(2), value);
    } else {
      node.setAttribute(name, value === true ? "" : value);
    }
  }
  node.append(...children.filter((child) => child !== null && child !== false));
  return node;
}

function announce(message) {
  announcer.textContent = message;
}

async function fetchJson(path) {
  let response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw new Error("Cannot reach the server. Check that it is running, then try again.", {
      cause: error,
    });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, body));
  }
  return body;
}

async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard) {
    const copied = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
    if (copied) {
      return true;
    }
  }
  // Over plain HTTP on the LAN the clipboard API is unavailable, so select and copy by hand
  const field = h("textarea", { readonly: true, class: "offscreen" });
  field.value = text;
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

function copyButton(release, extraClass = "") {
  const button = h("button", { type: "button", class: `plain ${extraClass}`.trim() }, "Copy link");
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const copied = await copyText(release.downloadUrl);
    button.textContent = copied ? "Copied" : "Copy failed";
    announce(copied ? "Download link copied" : "Could not copy the link");
    setTimeout(() => {
      button.textContent = "Copy link";
    }, FEEDBACK_MS);
  });
  return button;
}

function downloadLink(release) {
  return h(
    "a",
    {
      class: "button",
      href: release.downloadUrl,
      download: true,
      onclick: (event) => event.stopPropagation(),
    },
    "Download",
  );
}

function badge() {
  return h("span", { class: "badge" }, "Latest");
}

function select(id) {
  state.selectedId = id;
  for (const row of root.querySelectorAll("tr[data-id]")) {
    const selected = Number(row.dataset.id) === id;
    row.classList.toggle("selected", selected);
    row.querySelector(".pick").setAttribute("aria-current", String(selected));
  }
  renderDetails();
  const panel = document.getElementById("details");
  if (window.matchMedia("(max-width: 81.99rem)").matches) {
    panel.scrollIntoView({ block: "nearest" });
  }
}

function releaseRow(release, showApp) {
  const hash = shortHash(release.sha256);
  const pick = h(
    "button",
    {
      type: "button",
      class: "pick",
      "aria-current": String(release.id === state.selectedId),
    },
    release.versionName,
  );
  return h(
    "tr",
    {
      "data-id": String(release.id),
      class: release.id === state.selectedId ? "selected" : false,
      onclick: () => select(release.id),
    },
    showApp ? h("td", { class: "app-cell", title: release.appName }, release.appName) : null,
    h("td", {}, pick, state.latestIds.has(release.id) ? badge() : null),
    h("td", { class: "num wide-only" }, String(release.versionCode)),
    h("td", { class: "mid-only" }, dayFormat.format(new Date(release.createdAt))),
    h("td", { class: "num" }, formatFileSize(release.fileSize)),
    h(
      "td",
      { class: "mono mid-only", title: hash === null ? "No checksum recorded" : false },
      hash ?? "none",
    ),
    h("td", { class: "notes notes-wide" }, release.releaseNotes ?? ""),
    h(
      "td",
      { class: "actions" },
      h("div", {}, downloadLink(release), copyButton(release, "row-copy")),
    ),
  );
}

function releaseTable() {
  const showApp = new Set(state.releases.map((release) => release.appId)).size > 1;
  const head = h(
    "tr",
    {},
    showApp ? h("th", { scope: "col" }, "App") : null,
    h("th", { scope: "col" }, "Version"),
    h("th", { scope: "col", class: "num wide-only" }, "Code"),
    h("th", { scope: "col", class: "mid-only" }, "Uploaded"),
    h("th", { scope: "col", class: "num" }, "Size"),
    h("th", { scope: "col", class: "mid-only" }, "SHA-256"),
    h("th", { scope: "col", class: "notes-wide" }, "Notes"),
    h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Actions")),
  );
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h("thead", {}, head),
      h("tbody", {}, ...state.releases.map((release) => releaseRow(release, showApp))),
    ),
  );
}

function listFooter() {
  const shown = state.releases.length;
  const more = shown < state.total;
  return h(
    "div",
    { class: "list-footer" },
    h("p", {}, `Showing ${shown} of ${state.total} releases`),
    more
      ? h(
          "button",
          {
            type: "button",
            class: "plain",
            disabled: state.loadingMore,
            onclick: () => void loadMore(),
          },
          state.loadingMore ? "Loading…" : "Load more",
        )
      : null,
    state.loadMoreError === null ? null : h("p", { class: "error" }, state.loadMoreError),
  );
}

function detailRow(label, ...value) {
  return [h("dt", {}, label), h("dd", {}, ...value)];
}

function renderDetails() {
  const panel = document.getElementById("details");
  panel.replaceChildren();
  const release = state.releases.find((item) => item.id === state.selectedId);
  if (release === undefined) {
    panel.append(h("p", { class: "note" }, "Select a release to see its details."));
    return;
  }
  const link = h("input", {
    type: "text",
    readonly: true,
    value: release.downloadUrl,
    "aria-label": "Download link",
    onfocus: (event) => event.target.select(),
  });
  panel.append(
    h(
      "h2",
      {},
      `${release.appName} ${release.versionName}`,
      state.latestIds.has(release.id) ? badge() : null,
    ),
    h(
      "dl",
      {},
      ...detailRow("Version code", String(release.versionCode)),
      ...detailRow("File name", release.fileName),
      ...detailRow(
        "Size",
        `${formatFileSize(release.fileSize)} (${release.fileSize.toLocaleString()} bytes)`,
      ),
      ...detailRow(
        "SHA-256",
        release.sha256 === null
          ? "Not recorded. Run npm run backfill:sha256 on the server to add it."
          : h("span", { class: "mono hash" }, release.sha256),
      ),
      ...detailRow("Uploaded", dateFormat.format(new Date(release.createdAt))),
      ...detailRow("Release notes", release.releaseNotes ?? "None"),
    ),
    h("div", { class: "link-field" }, link),
    h("div", { class: "detail-actions" }, downloadLink(release), copyButton(release)),
  );
}

function renderList() {
  root.setAttribute("aria-busy", "false");
  if (state.releases.length === 0) {
    root.replaceChildren(
      h(
        "section",
        { class: "empty" },
        h("h2", {}, "No releases yet"),
        h("p", {}, "Upload an APK with npm run upload and it will appear here."),
      ),
    );
    return;
  }
  root.replaceChildren(
    h(
      "div",
      { class: "layout" },
      h("section", { class: "list", "aria-label": "Releases" }, releaseTable(), listFooter()),
      h("aside", { id: "details", class: "details", "aria-label": "Release details" }),
    ),
  );
  renderDetails();
}

function renderFailure(error) {
  root.setAttribute("aria-busy", "false");
  root.replaceChildren(
    h(
      "section",
      { class: "empty" },
      h("h2", {}, "Releases could not be loaded"),
      h("p", { class: "error" }, error instanceof Error ? error.message : "Unknown error."),
      h(
        "button",
        { type: "button", class: "plain", onclick: () => void loadFirstPage() },
        "Try again",
      ),
    ),
  );
}

async function loadFirstPage() {
  root.setAttribute("aria-busy", "true");
  try {
    const [apps, page] = await Promise.all([
      fetchJson("/api/apps"),
      fetchJson(`/api/apks?limit=${PAGE_SIZE}&offset=0`),
    ]);
    state.latestIds = latestReleaseIds(apps.data);
    state.releases = page.data;
    state.total = page.pagination.total;
    state.selectedId = null;
    state.loadMoreError = null;
    renderList();
  } catch (error) {
    renderFailure(error);
  }
}

async function loadMore() {
  state.loadingMore = true;
  state.loadMoreError = null;
  renderList();
  try {
    const page = await fetchJson(`/api/apks?limit=${PAGE_SIZE}&offset=${state.releases.length}`);
    // An upload between two requests shifts the offsets, so skip releases already shown
    const known = new Set(state.releases.map((release) => release.id));
    state.releases = [...state.releases, ...page.data.filter((release) => !known.has(release.id))];
    state.total = page.pagination.total;
  } catch (error) {
    state.loadMoreError = error instanceof Error ? error.message : "Unknown error.";
  }
  state.loadingMore = false;
  renderList();
}

await loadFirstPage();
