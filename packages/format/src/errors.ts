import type { ValidationIssue } from "@veloce/core";

export type FormatErrorCode =
  /** Not a .veloce file at all (not a zip, or no Veloce manifest). */
  | "NOT_VELOCE"
  /** Made by a newer Veloce with a format version this build can't read. */
  | "TOO_NEW"
  /** Structurally broken: unreadable JSON, missing parts, asset hash mismatch… */
  | "CORRUPT"
  /** The deck inside doesn't pass validation. */
  | "INVALID_DOCUMENT"
  /** The archive tries something dangerous (path traversal, size bombs). */
  | "UNSAFE"
  /** Writing: the deck and the provided asset bytes don't line up. */
  | "INCONSISTENT";

export class FormatError extends Error {
  readonly code: FormatErrorCode;
  readonly issues: readonly ValidationIssue[];

  constructor(code: FormatErrorCode, message: string, issues: readonly ValidationIssue[] = []) {
    super(message);
    this.name = "FormatError";
    this.code = code;
    this.issues = issues;
  }
}
