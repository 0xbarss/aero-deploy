import { describe, expect, it } from "vitest";
import { downloadFileName } from "../apks/download-name.js";

function name(appName: string, versionName: string, versionCode: number): string {
  return downloadFileName({ appName, versionName, versionCode });
}

describe("downloadFileName", () => {
  it("joins the app name, version name and version code", () => {
    expect(name("My Shop", "1.2.0", 12)).toBe("my-shop-1.2.0-12.apk");
  });

  it("keeps a suffix in the version name, such as a debug build", () => {
    expect(name("My Shop Debug", "1.2.0-debug", 12)).toBe("my-shop-debug-1.2.0-debug-12.apk");
  });

  it("keeps the case of the version name", () => {
    expect(name("Shop", "2.0-RC1", 5)).toBe("shop-2.0-RC1-5.apk");
  });

  it("strips accents from Turkish and other Latin letters", () => {
    expect(name("Dükkanım Çarşı Şeker Öğrenci Ğ İzmir", "1", 1)).toBe(
      "dukkanim-carsi-seker-ogrenci-g-izmir-1-1.apk",
    );
  });

  it("transliterates letters that have no accent form", () => {
    expect(name("Straße Ølsen Łódź", "1", 1)).toBe("strasse-olsen-lodz-1-1.apk");
  });

  it("collapses punctuation and spaces into single hyphens and trims them", () => {
    expect(name('  --My  &  "Shop"!! ', "1", 1)).toBe("my-shop-1-1.apk");
  });

  it.each(["日本語", "🙂🙂", "   ", "---"])("falls back to 'app' for the name %j", (appName) => {
    expect(name(appName, "1.0", 3)).toBe("app-1.0-3.apk");
  });

  it("cuts a long app name to 60 characters without a trailing hyphen", () => {
    expect(name("a".repeat(80), "1", 1)).toBe(`${"a".repeat(60)}-1-1.apk`);
    expect(name(`${"word ".repeat(20)}`, "1", 1)).toBe(
      `${"word-".repeat(12).slice(0, 59)}-1-1.apk`,
    );
  });

  it("replaces unsafe characters in the version name", () => {
    expect(name("Shop", "1.0.0 beta", 1)).toBe("shop-1.0.0-beta-1.apk");
    expect(name("Shop", "v1/2\\3", 1)).toBe("shop-v1-2-3-1.apk");
    expect(name("Shop", "1.0+build.5", 1)).toBe("shop-1.0+build.5-1.apk");
  });

  it("cannot be turned into a path by the version name", () => {
    expect(name("Shop", "../../etc", 1)).toBe("shop-etc-1.apk");
    expect(name("Shop", "..", 1)).toBe("shop-1.apk");
  });

  it("leaves the version name out when nothing of it is usable", () => {
    expect(name("Shop", "///", 7)).toBe("shop-7.apk");
    expect(name("Shop", "日本", 7)).toBe("shop-7.apk");
  });

  it.each([
    ["a\"b'c\\d/e:f", "x y"],
    ["\u0000\u0007\n", "1\r\n2"],
    ["名前", "名前"],
    ["Ünïcödé ✓", "ß"],
    ["%2e%2e", "%00"],
  ])("only produces header-safe characters for %j / %j", (appName, versionName) => {
    expect(name(appName, versionName, 9)).toMatch(/^[a-z0-9][A-Za-z0-9._+-]*\.apk$/);
  });
});
