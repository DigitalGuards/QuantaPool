export type RelayResetEvent = "accounts" | "disconnect" | "status";

/** Generation guard for the teardown events emitted by SDK newConnection(). */
export class RelayResetGuard {
  private generation = 0;
  private activeGeneration: number | null = null;

  begin(): number {
    const generation = ++this.generation;
    this.activeGeneration = generation;
    return generation;
  }

  isCurrent(generation: number): boolean {
    return this.activeGeneration === generation;
  }

  finish(generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    this.activeGeneration = null;
    return true;
  }

  invalidate(): void {
    this.generation += 1;
    this.activeGeneration = null;
  }

  get active(): boolean {
    return this.activeGeneration !== null;
  }
}

export function shouldIgnoreRelayResetEvent(
  guard: RelayResetGuard,
  event: RelayResetEvent,
): boolean {
  return (
    guard.active && (event === "accounts" || event === "disconnect" || event === "status")
  );
}

export type WalletConnectionKind = "relay" | "extension";

export type ExtensionActivationResult<T> =
  | { ok: true; value: T }
  | { ok: false; retirementError: unknown };

/** Retire every relay session before requesting and activating an extension. */
export async function activateExtensionAfterRelayRetirement<TAccounts, TResult>(
  retireRelay: () => Promise<unknown | null>,
  requestAccounts: () => Promise<TAccounts>,
  activate: (accounts: TAccounts) => TResult | Promise<TResult>,
): Promise<ExtensionActivationResult<TResult>> {
  const retirementError = await retireRelay();
  if (retirementError !== null) return { ok: false, retirementError };

  const accounts = await requestAccounts();
  return { ok: true, value: await activate(accounts) };
}

/** Serializes picker selections and generation-binds their async results. */
export class ConnectionAttemptGuard {
  private generation = 0;
  private current: { generation: number; kind: WalletConnectionKind } | null = null;

  begin(kind: WalletConnectionKind): number | null {
    if (this.current) return null;
    const generation = ++this.generation;
    this.current = { generation, kind };
    return generation;
  }

  isCurrent(generation: number): boolean {
    return this.current?.generation === generation;
  }

  isPending(kind?: WalletConnectionKind): boolean {
    return this.current !== null && (kind === undefined || this.current.kind === kind);
  }

  finish(generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    this.current = null;
    return true;
  }

  invalidate(): void {
    this.generation += 1;
    this.current = null;
  }
}

/** Deduplicates work within one channel without blocking a replacement channel. */
export class ChannelTaskGuard {
  private current: { channelId: string; task: Promise<void> } | null = null;

  run(channelId: string, start: () => Promise<void>): Promise<void> {
    if (this.current?.channelId === channelId) return this.current.task;

    const work = start();
    const tracked = work.finally(() => {
      if (this.current?.task === tracked) this.current = null;
    });
    this.current = { channelId, task: tracked };
    return tracked;
  }

  isPending(channelId?: string): boolean {
    return (
      this.current !== null &&
      (channelId === undefined || this.current.channelId === channelId)
    );
  }
}
