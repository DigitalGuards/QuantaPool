import { useEffect, useLayoutEffect, useRef } from "react";
import {
  defineQrlApprovalHint,
  QrlApprovalHint,
  QRL_APPROVAL_HINT_TAG,
} from "@qrlwallet/connect-ui/approval";
import type { ApprovalWallet } from "@qrlwallet/connect-ui/wallets";

interface Props {
  /** The wallet the open request went to, or null when it is unknown. */
  wallet: ApprovalWallet | null;
  /** A wallet request is open and has not been answered. */
  pending: boolean;
  className?: string;
}

const UNKNOWN_WALLET: ApprovalWallet = {
  name: "",
  icon: null,
  kind: "extension",
};

/**
 * Thin React wrapper around <qrl-approval-hint> from @qrlwallet/connect-ui.
 * The element shows itself once `pending` has lasted its delay, names the
 * wallet to open and never opens or raises anything.
 */
export function ApprovalHint({ wallet, pending, className }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const elRef = useRef<QrlApprovalHint | null>(null);

  useLayoutEffect(() => {
    defineQrlApprovalHint();
    // createElement works with whichever copy of the element class holds the
    // tag; a constructor call only with this one.
    const el = document.createElement(QRL_APPROVAL_HINT_TAG);
    if (!(el instanceof QrlApprovalHint)) return undefined;
    hostRef.current?.append(el);
    elRef.current = el;
    return () => {
      el.remove();
      elRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (elRef.current) elRef.current.wallet = wallet ?? UNKNOWN_WALLET;
  }, [wallet]);

  useEffect(() => {
    if (elRef.current) elRef.current.pending = pending;
  }, [pending]);

  // The host takes its spacing only while the hint shows, so a hidden hint
  // leaves no gap.
  return (
    <div ref={hostRef} className={className} data-testid="approval-hint" />
  );
}
