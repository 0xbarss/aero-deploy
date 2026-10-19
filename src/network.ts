import { networkInterfaces } from "node:os";

/**
 * The IPv4 addresses of this machine that a phone on the same network could use to reach the
 * server.
 *
 * The addresses are ordered so that the ones on a home or office network come first: a machine
 * often has a container bridge as well, and that address is not reachable from a phone.
 */
export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      if (!found.includes(entry.address)) {
        found.push(entry.address);
      }
    }
  }
  return found.sort(compareAddresses);
}

/** Sorts the addresses so the ones a phone is most likely to reach come first. */
function compareAddresses(a: string, b: string): number {
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** How likely an address is to be the one a phone on the same network can use. */
function rank(address: string): number {
  if (address.startsWith("192.168.")) {
    return 0;
  }
  if (address.startsWith("10.")) {
    return 1;
  }
  if (isPrivate172(address)) {
    return 2;
  }
  return 3;
}

function isPrivate172(address: string): boolean {
  const parts = address.split(".");
  const second = Number(parts[1]);
  return parts[0] === "172" && second !== undefined && second >= 16 && second <= 31;
}
