import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Minimum patched versions for transitive dependencies that have been flagged
// by Dependabot (SDK-730). Keyed by package, then by major version, because a
// lockfile can hold several copies of one package on different major lines
// (e.g. brace-expansion 1.x under eslint and 5.x under typescript-eslint).
// When a new alert is fixed by refreshing the lockfile, raise or add the floor
// here so a later lockfile regeneration can't silently reintroduce it.
const PATCHED_FLOORS: Record<string, Record<number, string>> = {
  // GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw
  "ip-address": { 10: "10.7.1" },
  // GHSA-q2hr-2g5m-vwhr
  "brace-expansion": { 1: "1.1.21", 5: "5.0.12" },
  // GHSA-58mr-gqgx-xq4g, GHSA-qw65-cvwx-89v3
  "fast-uri": { 3: "3.1.7" },
  // GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx
  qs: { 6: "6.16.0" },
  // GHSA-3wwx-pv8p-q78v
  undici: { 7: "7.29.1" },
  // GHSA-p498-v437-472g
  "@humanfs/node": { 0: "0.16.8" },
};

interface LockfilePackage {
  version?: string;
}

interface Lockfile {
  packages: Record<string, LockfilePackage>;
}

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeast(version: string, floor: string): boolean {
  const a = parseVersion(version);
  const b = parseVersion(floor);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return true;
}

// Every installed copy of `name`, including nested ones such as
// node_modules/foo/node_modules/<name>.
function installedCopies(lockfile: Lockfile, name: string) {
  const suffix = `node_modules/${name}`;
  return Object.entries(lockfile.packages)
    .filter(([path]) => path === suffix || path.endsWith(`/${suffix}`))
    .map(([path, pkg]) => ({ path, version: pkg.version ?? "" }));
}

const lockfile: Lockfile = JSON.parse(
  readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"),
);

describe("lockfile advisory floors", () => {
  describe("version comparison", () => {
    it("compares numerically rather than lexically", () => {
      expect(isAtLeast("1.1.21", "1.1.21")).toBe(true);
      expect(isAtLeast("1.1.100", "1.1.21")).toBe(true);
      expect(isAtLeast("1.1.9", "1.1.21")).toBe(false);
      expect(isAtLeast("10.7.0", "10.7.1")).toBe(false);
      expect(isAtLeast("10.8.0", "10.7.1")).toBe(true);
    });

    it("rejects versions it cannot compare", () => {
      expect(() => isAtLeast("1.0.0-beta.1", "1.0.0")).toThrow(
        "Unsupported version format",
      );
    });
  });

  describe("installedCopies", () => {
    it("finds top-level and nested copies but not packages with a matching suffix", () => {
      const fixture: Lockfile = {
        packages: {
          "": { version: "0.0.0" },
          "node_modules/qs": { version: "6.16.0" },
          "node_modules/express/node_modules/qs": { version: "6.15.0" },
          "node_modules/not-qs": { version: "1.0.0" },
        },
      };

      expect(installedCopies(fixture, "qs")).toEqual([
        { path: "node_modules/qs", version: "6.16.0" },
        { path: "node_modules/express/node_modules/qs", version: "6.15.0" },
      ]);
    });
  });

  for (const [name, floors] of Object.entries(PATCHED_FLOORS)) {
    it(`${name} has no copy below its patched version`, () => {
      const copies = installedCopies(lockfile, name);
      // A missing package means the floor entry is stale (or misspelled) and
      // the test would pass vacuously; drop the entry if the dependency is gone.
      expect(copies, `${name} not found in package-lock.json`).not.toHaveLength(
        0,
      );

      for (const { path, version } of copies) {
        const major = parseVersion(version)[0];
        const floor = floors[major];
        expect(
          floor,
          `${path}@${version}: no patched floor recorded for major ${major}`,
        ).toBeDefined();
        expect(
          isAtLeast(version, floor),
          `${path}@${version} is below patched version ${floor}`,
        ).toBe(true);
      }
    });
  }
});
