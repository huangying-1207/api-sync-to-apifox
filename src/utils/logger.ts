let quietMode = false;
let jsonMode = false;

export function setLogOptions(options: { quiet?: boolean; json?: boolean }): void {
  quietMode = options.quiet === true;
  jsonMode = options.json === true;
}

export function isQuietMode(): boolean {
  return quietMode;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function appLog(...args: unknown[]): void {
  if (!quietMode) console.log(...args);
}

export function appWarn(...args: unknown[]): void {
  if (!quietMode) console.warn(...args);
}
