// shared/ compiles without DOM or Workers types, so the one runtime global it relies on beyond
// ES2022 is declared here. Browsers, workerd and Node all provide it.
declare function structuredClone<T>(value: T): T;
