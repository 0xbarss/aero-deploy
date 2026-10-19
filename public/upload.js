import { h } from "./dom.js";
import {
  apiErrorMessage,
  formatFileSize,
  isApkFileName,
  parseJsonBody,
  progressLabel,
  uploadSummary,
} from "./release-view.js";

const UNREACHABLE = "Cannot reach the server. Check that it is running, then try again.";

/**
 * Builds the upload form inside `container`.
 * The upload token is kept in page memory only and is asked for after the server refuses an
 * upload with 401, so a server without an upload token never asks for one.
 */
export function mountUpload(container, { announce, onUploaded }) {
  const ui = { file: null, token: null, needsToken: false, request: null };

  const picker = h("input", {
    type: "file",
    class: "sr-only",
    accept: ".apk,application/vnd.android.package-archive",
  });
  const dropText = h("span", {}, "Drop an APK here or choose a file");
  const drop = h("label", { class: "drop" }, picker, dropText);
  const notes = h("textarea", { id: "release-notes", rows: "2", autocomplete: "off" });
  const tokenField = h("input", { type: "password", id: "upload-token", autocomplete: "off" });
  const tokenRow = h(
    "div",
    { class: "field", hidden: true },
    h("label", { for: "upload-token" }, "Upload token (the admin token also works)"),
    tokenField,
  );
  const submit = h("button", { type: "button", class: "button", disabled: true }, "Upload");
  const cancel = h("button", { type: "button", class: "plain", hidden: true }, "Cancel");
  const bar = h("progress", {
    max: "100",
    value: "0",
    hidden: true,
    "aria-label": "Upload progress",
  });
  const status = h("p", { class: "note", role: "status" });
  const error = h("p", { class: "error", role: "alert" });

  function setBusy(busy) {
    for (const control of [picker, notes, tokenField, submit]) {
      control.disabled = busy || (control === submit && ui.file === null);
    }
    cancel.hidden = !busy;
    bar.hidden = !busy;
  }

  function showError(message) {
    error.textContent = message;
  }

  function pick(file) {
    showError("");
    status.textContent = "";
    if (file === undefined) {
      return;
    }
    if (!isApkFileName(file.name)) {
      showError("Choose an .apk file.");
      return;
    }
    ui.file = file;
    dropText.textContent = `${file.name} (${formatFileSize(file.size)})`;
    submit.disabled = false;
  }

  function clearForm() {
    ui.file = null;
    dropText.textContent = "Drop an APK here or choose a file";
    notes.value = "";
    tokenField.value = "";
  }

  picker.addEventListener("change", () => {
    pick(picker.files[0]);
    // Lets the same file be chosen again after a failed upload
    picker.value = "";
  });
  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("dragging");
    });
  }
  drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("dragging");
    const files = event.dataTransfer.files;
    if (files.length > 1) {
      showError("Drop one APK at a time.");
      return;
    }
    pick(files[0]);
  });

  async function finish(httpStatus, body, token) {
    setBusy(false);
    ui.request = null;
    if (httpStatus === 201 && body?.data) {
      ui.token = token === "" ? null : token;
      ui.needsToken = false;
      tokenRow.hidden = true;
      clearForm();
      setBusy(false);
      status.textContent = uploadSummary(body.data);
      announce(status.textContent);
      await onUploaded();
      return;
    }
    status.textContent = "";
    showError(apiErrorMessage(httpStatus, body));
    if (httpStatus === 401) {
      // A wrong token is dropped, so the form asks for it again
      ui.token = null;
      ui.needsToken = true;
      tokenRow.hidden = false;
      tokenField.focus();
    }
  }

  submit.addEventListener("click", () => {
    if (ui.file === null) {
      return;
    }
    showError("");
    status.textContent = progressLabel(0, 0);
    bar.value = 0;
    const body = new FormData();
    body.append("apk", ui.file, ui.file.name);
    if (notes.value.trim() !== "") {
      body.append("releaseNotes", notes.value.trim());
    }
    const token = ui.needsToken ? tokenField.value : (ui.token ?? "");
    const request = new XMLHttpRequest();
    ui.request = request;
    request.open("POST", "/api/apks/upload");
    request.setRequestHeader("Accept", "application/json");
    if (token !== "") {
      request.setRequestHeader("Authorization", `Bearer ${token}`);
    }
    request.upload.addEventListener("progress", (event) => {
      const total = event.lengthComputable ? event.total : 0;
      status.textContent = progressLabel(event.loaded, total);
      bar.value = total > 0 ? Math.min(100, (event.loaded / total) * 100) : 0;
    });
    request.addEventListener("load", () => {
      void finish(request.status, parseJsonBody(request.responseText), token);
    });
    request.addEventListener("error", () => {
      setBusy(false);
      ui.request = null;
      status.textContent = "";
      showError(UNREACHABLE);
    });
    request.addEventListener("abort", () => {
      setBusy(false);
      ui.request = null;
      status.textContent = "Upload cancelled.";
    });
    setBusy(true);
    request.send(body);
  });
  cancel.addEventListener("click", () => ui.request?.abort());

  container.replaceChildren(
    h("h2", {}, "Upload a release"),
    drop,
    h(
      "div",
      { class: "field" },
      h("label", { for: "release-notes" }, "Release notes (optional)"),
      notes,
    ),
    tokenRow,
    h("div", { class: "upload-actions" }, submit, cancel),
    bar,
    status,
    error,
  );
}
