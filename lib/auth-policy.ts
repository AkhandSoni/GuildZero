export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 100;
export function validNewPassword(value: unknown): value is string {
  return typeof value === "string" && [...value.normalize("NFC")].length >= MIN_PASSWORD_LENGTH && [...value.normalize("NFC")].length <= MAX_PASSWORD_LENGTH && value.trim() === value;
}
export function authErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    PASSWORD_TOO_SHORT: "Use at least 10 characters for your new password.",
    PASSWORD_TOO_LONG: "Use no more than 100 characters for your new password.",
    PASSWORD_TOO_COMMON: "Choose a less common password or a longer passphrase.",
    PASSWORD_HAS_SURROUNDING_WHITESPACE: "Remove spaces at the start and end of your password.",
    RATE_LIMITED: "Too many attempts. Wait a minute before trying again.",
  };
  return messages[code] ?? "Unable to sign in. Check your email and password. If you have not registered in this app, choose Sign up below.";
}
