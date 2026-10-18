const MAX_SLUG_LENGTH = 60;
const FALLBACK_SLUG = "app";

// Letters that do not decompose into a base letter and an accent
const TRANSLITERATIONS: Record<string, string> = {
  ı: "i",
  ß: "ss",
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  æ: "ae",
  œ: "oe",
  þ: "th",
};

function slugify(appName: string): string {
  const slug = appName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[ıßøłđðæœþ]/g, (letter) => TRANSLITERATIONS[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "") || FALLBACK_SLUG;
}

/** Keeps letters, digits and . _ + -; anything else becomes a hyphen. */
function cleanVersionName(versionName: string): string {
  return versionName
    .replace(/[^A-Za-z0-9._+-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._+]+|[-._+]+$/g, "");
}

export interface DownloadNameSource {
  appName: string;
  versionName: string;
  versionCode: number;
}

/**
 * The file name a download is offered under: `<app-name-slug>-<versionName>-<versionCode>.apk`.
 * It only holds ASCII letters, digits and . _ + -, so it is safe in a header, on disk and in a
 * path. A version name with nothing usable in it is left out.
 */
export function downloadFileName(source: DownloadNameSource): string {
  const parts = [
    slugify(source.appName),
    cleanVersionName(source.versionName),
    String(source.versionCode),
  ];
  return `${parts.filter((part) => part !== "").join("-")}.apk`;
}
