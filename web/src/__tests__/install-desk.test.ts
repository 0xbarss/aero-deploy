import { describe, expect, it } from "vitest";
import { DESK_TARGETS, deskTargets, installCommand, installHost, pickDeskTarget } from "../format";

interface Build {
  id: number;
  versionName: string;
}

const BUILDS: Build[] = [
  { id: 7, versionName: "1.4.0" },
  { id: 6, versionName: "1.3.2" },
  { id: 5, versionName: "1.3.1" },
  { id: 4, versionName: "1.3.0" },
  { id: 3, versionName: "1.2.0" },
];

describe("deskTargets", () => {
  it("offers the first builds of the list", () => {
    expect(deskTargets(BUILDS).map((build) => build.id)).toEqual([7, 6, 5, 4]);
  });

  it("offers no more than the desk can show", () => {
    expect(deskTargets(BUILDS)).toHaveLength(DESK_TARGETS);
    expect(deskTargets(BUILDS, 2)).toHaveLength(2);
  });

  it("offers nothing when the server holds no build", () => {
    expect(deskTargets([])).toEqual([]);
  });

  it("leaves the list it was given alone", () => {
    const builds = [...BUILDS];
    deskTargets(builds);
    expect(builds).toEqual(BUILDS);
  });
});

describe("pickDeskTarget", () => {
  it("takes the build that was picked", () => {
    expect(pickDeskTarget(BUILDS, 5)?.versionName).toBe("1.3.1");
  });

  it("falls back to the first build when nothing was picked", () => {
    expect(pickDeskTarget(BUILDS, null)?.versionName).toBe("1.4.0");
  });

  it("falls back to the first build when the picked one is gone", () => {
    expect(pickDeskTarget(BUILDS, 99)?.versionName).toBe("1.4.0");
  });

  it("has nothing to show when the server holds no build", () => {
    expect(pickDeskTarget([], 7)).toBeNull();
    expect(pickDeskTarget([], null)).toBeNull();
  });
});

describe("installCommand", () => {
  it("fetches the file to the machine the command runs on", () => {
    expect(installCommand("http://192.168.1.20:3000/api/apks/download/3")).toBe(
      "curl -OJ http://192.168.1.20:3000/api/apks/download/3",
    );
  });
});

describe("installHost", () => {
  it("names the host of an install link", () => {
    expect(installHost("http://192.168.1.20:3000/api/apks/download/3")).toBe("192.168.1.20");
  });

  it("has no host for a link that cannot be read", () => {
    expect(installHost("not a link")).toBeNull();
    expect(installHost("")).toBeNull();
  });
});
