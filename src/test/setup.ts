import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

if (typeof AbortSignal !== "undefined" && typeof AbortSignal.prototype.throwIfAborted !== "function") {
  Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
    configurable: true,
    writable: true,
    value() {
      if (this.aborted) {
        throw this.reason ?? new Error("The operation was aborted.");
      }
    },
  });
}
