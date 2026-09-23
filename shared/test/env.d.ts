// The shared tests run in Node, which provides console; this folder compiles without DOM types.
declare const console: { log(...a: unknown[]): void; error(...a: unknown[]): void; warn(...a: unknown[]): void };
