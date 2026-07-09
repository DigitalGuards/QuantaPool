import { useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";
import { defineQrlPairingModal, QrlPairingModal } from "@qrlwallet/connect-ui";
import { useStore } from "@/stores/store";

/**
 * "Pair MyQRLWallet" modal for the relay (connect SDK) path, now the shared
 * <qrl-pairing-modal> web component from @qrlwallet/connect-ui instead of a
 * hand-copied QR card. Self-gates on poolStore.pairingUri; the element's
 * qrl-new-connection / qrl-cancel events map onto the store actions.
 */
export const QrPairModal = observer(() => {
  const { poolStore } = useStore();
  const uri = poolStore.pairingUri;
  const status = poolStore.pairingStatus;
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const elRef = useRef<QrlPairingModal | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!uri) return;
    defineQrlPairingModal();
    const el = new QrlPairingModal();
    el.setAttribute("uri", uri);
    if (statusRef.current) el.setAttribute("status", statusRef.current);
    const onNew = () => void poolStore.newConnection();
    const onDismiss = () => poolStore.cancelPairing();
    el.addEventListener("qrl-new-connection", onNew);
    el.addEventListener("qrl-cancel", onDismiss);
    hostRef.current?.append(el);
    elRef.current = el;
    return () => {
      // Listeners off before remove(): removal fires qrl-cancel by design
      // (external-unmount dismissal), which must not loop back into MobX.
      el.removeEventListener("qrl-new-connection", onNew);
      el.removeEventListener("qrl-cancel", onDismiss);
      el.remove();
      elRef.current = null;
    };
  }, [uri, poolStore]);

  useEffect(() => {
    if (!elRef.current) return;
    if (status) elRef.current.setAttribute("status", status);
    else elRef.current.removeAttribute("status");
  }, [status]);

  if (!uri) return null;
  return <span ref={hostRef} />;
});
