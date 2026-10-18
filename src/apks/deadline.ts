import { InvalidApkError } from "../errors.js";

/** Checked between read and parse steps; it cannot interrupt a single synchronous parse. */
export class Deadline {
  private readonly endsAt: number;

  constructor(timeoutMs: number) {
    this.endsAt = Date.now() + timeoutMs;
  }

  check(): void {
    if (Date.now() >= this.endsAt) {
      throw new InvalidApkError("Reading the APK took too long");
    }
  }
}
