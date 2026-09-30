export class ProviderError extends Error {
  /** code: "unavailable" | "failed" | "not-implemented" */
  constructor(code, message) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}
