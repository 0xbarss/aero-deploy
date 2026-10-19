import { h, replaceContent } from "./dom.js";
import { probeDownload } from "./download.js";
import {
  apiErrorMessage,
  confirmationNote,
  deleteFailureMessage,
  downloadFailure,
  filterableApps,
  formatFileSize,
  latestReleaseIds,
  matchesVersionName,
  releasesQuery,
  shortHash,
  successorOf,
} from "./release-view.js";
import { mountUpload } from "./upload.js";

const PAGE_SIZE = 50;
const FEEDBACK_MS = 1800;

const root = document.getElementById("app");
const announcer = document.getElementById("announce");
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const state = {
  apps: [],
  appFilter: null,
  // Kept in memory only, so it is asked for again after a reload
  adminToken: null,
  confirm: null,
  // The reason the last Download click on a release did not start a download
  downloadProblem: null,
  notice: null,
  releases: [],
  total: 0,
  latestIds: new Set(),
  selectedId: null,
  loadingMore: false,
  loadMoreError: null,
};

function announce(message) {
  announcer.textContent = message;
}

class RequestFailed extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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

async function startDownload(event, release, link) {
  event.stopPropagation();
  const modified = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
  if (event.button !== 0 || modified) {
    return;
  }
  // The link keeps its address for "save link as", but a plain click is checked first, so a
  // missing file gives a message instead of a saved error page
  event.preventDefault();
  if (link.getAttribute("aria-disabled") === "true") {
    return;
  }
  link.setAttribute("aria-disabled", "true");
  link.textContent = "Checking…";
  let failure = null;
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
  link.removeAttribute("aria-disabled");
  link.textContent = "Download";
  if (failure === null) {
    if (state.downloadProblem !== null) {
      state.downloadProblem = null;
      renderDetails();
    }
    window.location.assign(release.downloadUrl);
    return;
  }
  if (failure.releaseRemoved) {
    const message = `${release.appName} ${release.versionName} was already removed.`;
    announce(message);
    await loadFirstPage(message);
    return;
  }
  state.downloadProblem = { releaseId: release.id, message: failure.message };
  select(release.id);
  // The panel scrolls inside itself on wide screens, so the message may start below the fold
  document.querySelector("#details .error")?.scrollIntoView({ block: "nearest" });
}

function downloadLink(release) {
  const link = h(
    "a",
    {
      class: "button",
      href: release.downloadUrl,
      download: true,
      onclick: (event) => void startDownload(event, release, link),
    },
    "Download",
  );
  return link;
}

function badge() {
  return h("span", { class: "badge" }, "Latest");
}

function select(id) {
  state.selectedId = id;
  state.confirm = null;
  if (state.downloadProblem !== null && state.downloadProblem.releaseId !== id) {
    state.downloadProblem = null;
  }
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

async function sendDelete(releaseId, token) {
  let response;
  try {
    response = await fetch(`/api/apks/${releaseId}`, {
      method: "DELETE",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new Error("Cannot reach the server. Check that it is running, then try again.", {
      cause: error,
    });
  }
  if (response.status === 204) {
    return;
  }
  const body = await response.json().catch(() => null);
  throw new RequestFailed(response.status, deleteFailureMessage(response.status, body));
}

async function finishDelete(release, message) {
  state.confirm = null;
  state.selectedId = null;
  announce(message);
  await loadFirstPage(message);
}

function confirmForm(release) {
  const needsToken = state.adminToken === null;
  const typed = h("input", {
    type: "text",
    id: "confirm-version",
    autocomplete: "off",
    spellcheck: "false",
  });
  const token = needsToken
    ? h("input", { type: "password", id: "admin-token", autocomplete: "off" })
    : null;
  const error = h("p", { class: "error", role: "alert" }, state.confirm.error ?? "");
  const submit = h(
    "button",
    { type: "submit", class: "danger-solid", disabled: true },
    "Delete release",
  );
  const cancel = h(
    "button",
    {
      type: "button",
      class: "plain",
      onclick: () => {
        state.confirm = null;
        renderDetails();
      },
    },
    "Cancel",
  );
  const refresh = () => {
    submit.disabled =
      !matchesVersionName(typed.value, release.versionName) || (needsToken && token.value === "");
  };
  typed.addEventListener("input", refresh);
  token?.addEventListener("input", refresh);

  const form = h(
    "form",
    { class: "confirm", novalidate: true },
    h("h3", {}, `Delete ${release.versionName}?`),
    h(
      "p",
      {},
      "This removes the release and its file from the server. Phones that already installed it keep it.",
    ),
    state.confirm.note === null ? null : h("p", {}, state.confirm.note),
    h("label", { for: "confirm-version" }, `Type ${release.versionName} to confirm`),
    typed,
    needsToken ? h("label", { for: "admin-token" }, "Admin token") : null,
    token,
    error,
    h("div", { class: "detail-actions" }, submit, cancel),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) {
      return;
    }
    const bearer = state.adminToken ?? token.value;
    submit.disabled = true;
    cancel.disabled = true;
    submit.textContent = "Deleting…";
    error.textContent = "";
    try {
      await sendDelete(release.id, bearer);
    } catch (failure) {
      const status = failure instanceof RequestFailed ? failure.status : 0;
      if (status === 404) {
        await finishDelete(
          release,
          `${release.appName} ${release.versionName} was already removed.`,
        );
        return;
      }
      const message = failure instanceof Error ? failure.message : "Unknown error.";
      if (status === 401) {
        // A wrong token is dropped, so the form asks for it again
        state.adminToken = null;
        state.confirm.error = message;
        renderDetails();
        document.getElementById("confirm-version").focus();
        return;
      }
      error.textContent = message;
      submit.textContent = "Delete release";
      cancel.disabled = false;
      refresh();
      return;
    }
    state.adminToken = bearer;
    await finishDelete(release, `Deleted ${release.appName} ${release.versionName}.`);
  });
  return form;
}

async function openConfirm(release, button, panel) {
  const isLatest = state.latestIds.has(release.id);
  let successor = null;
  if (isLatest) {
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      const page = await fetchJson(`/api/apks?${releasesQuery(release.appId, 2, 0)}`);
      successor = successorOf(release.id, page.data);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Delete release…";
      panel.append(
        h("p", { class: "error" }, error instanceof Error ? error.message : "Unknown error."),
      );
      return;
    }
  }
  state.confirm = {
    releaseId: release.id,
    note: confirmationNote(release.appName, isLatest, successor),
    error: null,
  };
  renderDetails();
  document.getElementById("confirm-version").focus();
}

function deleteSection(release, panel) {
  if (state.confirm !== null && state.confirm.releaseId === release.id) {
    return confirmForm(release);
  }
  const button = h("button", { type: "button", class: "danger" }, "Delete release…");
  button.addEventListener("click", () => void openConfirm(release, button, panel));
  return h("div", { class: "danger-zone" }, button);
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
    state.downloadProblem?.releaseId === release.id
      ? h("p", { class: "error", role: "alert" }, state.downloadProblem.message)
      : null,
    deleteSection(release, panel),
  );
}

function filterBar() {
  const apps = filterableApps(state.apps);
  if (apps.length < 2) {
    return null;
  }
  const choice = h(
    "select",
    {
      id: "app-filter",
      onchange: (event) => {
        state.appFilter = event.target.value === "" ? null : Number(event.target.value);
        void loadFirstPage();
      },
    },
    h("option", { value: "" }, "All apps"),
    ...apps.map((app) =>
      h("option", { value: String(app.id), selected: app.id === state.appFilter }, app.name),
    ),
  );
  return h("div", { class: "toolbar" }, h("label", { for: "app-filter" }, "App"), choice);
}

function renderList() {
  root.setAttribute("aria-busy", "false");
  const filterHadFocus = document.activeElement?.id === "app-filter";
  const notice = state.notice === null ? null : h("p", { class: "notice" }, state.notice);
  if (state.releases.length === 0) {
    replaceContent(
      root,
      notice,
      h(
        "section",
        { class: "empty" },
        h("h2", {}, "No releases yet"),
        h("p", {}, "Upload an APK above, or with npm run upload, and it will appear here."),
      ),
    );
    return;
  }
  replaceContent(
    root,
    notice,
    h(
      "div",
      { class: "layout" },
      h(
        "section",
        { class: "list", "aria-label": "Releases" },
        filterBar(),
        releaseTable(),
        listFooter(),
      ),
      h("aside", { id: "details", class: "details", "aria-label": "Release details" }),
    ),
  );
  renderDetails();
  if (filterHadFocus) {
    document.getElementById("app-filter")?.focus();
  }
}

function renderFailure(error) {
  root.setAttribute("aria-busy", "false");
  replaceContent(
    root,
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

async function loadFirstPage(notice = null) {
  root.setAttribute("aria-busy", "true");
  try {
    const apps = await fetchJson("/api/apps");
    state.apps = apps.data;
    state.latestIds = latestReleaseIds(apps.data);
    // The filtered app may have lost its last release
    if (!filterableApps(state.apps).some((app) => app.id === state.appFilter)) {
      state.appFilter = null;
    }
    const page = await fetchJson(`/api/apks?${releasesQuery(state.appFilter, PAGE_SIZE, 0)}`);
    state.releases = page.data;
    state.total = page.pagination.total;
    state.selectedId = null;
    state.confirm = null;
    state.downloadProblem = null;
    state.notice = notice;
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
    const page = await fetchJson(
      `/api/apks?${releasesQuery(state.appFilter, PAGE_SIZE, state.releases.length)}`,
    );
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

mountUpload(document.getElementById("upload"), {
  announce,
  onUploaded: () => loadFirstPage(),
});
await loadFirstPage();
