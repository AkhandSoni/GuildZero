/** Executable protocol specification only; no production imports or payment APIs. */
export type Phase = "READY" | "PREPARING" | "SIGNING_STARTED" | "SIGNED_IDENTITY" | "BROADCAST_ADMITTED" | "CLOSED_PRE_SIGN_FAILURE";
export type Attempt = { generation: number; token: string; phase: Phase; replaced: boolean };
export class RecoveryProtocolModel {
  readonly history: Attempt[] = [];
  current: Attempt = { generation: 1, token: "server-claim-1", phase: "READY", replaced: false };
  private same(generation: number, token: string) { return this.current.generation === generation && this.current.token === token; }
  authorize(expectedGeneration: number, checks: { owner: boolean; binding: boolean; allowance: boolean; signerClear: boolean }) {
    if (expectedGeneration !== this.current.generation || this.current.phase !== "READY" || !Object.values(checks).every(Boolean)) return false;
    this.current = { ...this.current, phase: "PREPARING" };
    return true;
  }
  transition(generation: number, token: string, from: Phase, to: Phase) {
    const allowed: Partial<Record<Phase, Phase[]>> = {
      PREPARING: ["SIGNING_STARTED", "CLOSED_PRE_SIGN_FAILURE"],
      SIGNING_STARTED: ["SIGNED_IDENTITY"], SIGNED_IDENTITY: ["BROADCAST_ADMITTED"],
    };
    if (!this.same(generation, token) || this.current.phase !== from || !allowed[from]?.includes(to)) return false;
    this.current = { ...this.current, phase: to };
    return true;
  }
  replace(expectedGeneration: number, checks: { owner: boolean; binding: boolean; allowance: boolean; signerClear: boolean }) {
    if (expectedGeneration !== this.current.generation || this.current.phase !== "CLOSED_PRE_SIGN_FAILURE" || this.current.replaced ||
        this.history.length >= 4 || !Object.values(checks).every(Boolean)) return false;
    this.history.push({ ...this.current, replaced: true });
    this.current = { generation: expectedGeneration + 1, token: `server-claim-${expectedGeneration + 1}`, phase: "READY", replaced: false };
    return true;
  }
}
