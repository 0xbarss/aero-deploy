// Matches the length of apps.name
const MAX_NAME_LENGTH = 100;
const DEBUG_SUFFIX = " (debug)";
// C0 and C1 control characters, which include the NUL byte PostgreSQL cannot store
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

export interface AppNameSource {
  /** The appName form field, when the client sent one */
  requestedName: string | null;
  /** The label in the manifest, when it has a readable one */
  label: string | null;
  packageName: string;
  debuggable: boolean;
}

function clean(value: string | null): string {
  return value === null ? "" : value.replace(CONTROL_CHARACTERS, "").trim();
}

/** Cuts by code point, so a character outside the basic plane is never split. */
function cut(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("").trim();
}

/**
 * The names to try for a new app, in order: the label (or the requested name), the same with a
 * suffix that tells builds of one app apart, and finally the package name, which is unique.
 */
export function appNameCandidates(source: AppNameSource): string[] {
  const candidates: string[] = [];
  const base = [clean(source.requestedName), clean(source.label)].find((name) => name !== "");

  if (base !== undefined) {
    candidates.push(cut(base, MAX_NAME_LENGTH));
    const suffix = source.debuggable ? DEBUG_SUFFIX : ` (${source.packageName})`;
    const room = MAX_NAME_LENGTH - Array.from(suffix).length;
    if (room > 0) {
      candidates.push(`${cut(base, room)}${suffix}`);
    }
  }
  candidates.push(cut(source.packageName, MAX_NAME_LENGTH));

  return [...new Set(candidates)];
}
