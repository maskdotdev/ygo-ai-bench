let nextActionWindowToken = 0;

export function createActionWindowToken(): string {
  nextActionWindowToken += 1;
  return `window-${nextActionWindowToken.toString(36)}`;
}
