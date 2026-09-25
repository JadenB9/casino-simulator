// The shared tests run in Node, which provides console; this folder compiles without DOM types.
declare const console: { log(...a: unknown[]): void; error(...a: unknown[]): void; warn(...a: unknown[]): void };
// Node's clock, for the tests that time the Hold'em bots.
declare const performance: { now(): number };
