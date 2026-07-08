import { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import QRCode from "qrcode";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { Button } from "@/components/UI/Button";
import { useStore } from "@/stores/store";

/**
 * "Pair MyQRLWallet" QR modal for the relay (connect SDK) path. Shows the
 * qrlconnect:// URI as a QR plus a desktop deep-link and copy-code fallback,
 * mirroring the reference dApp example. Self-gates on poolStore.pairingUri.
 */
export const QrPairModal = observer(() => {
  const { poolStore } = useStore();
  const uri = poolStore.pairingUri;
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!uri) {
      setDataUrl(null);
      return;
    }
    let alive = true;
    void QRCode.toDataURL(uri, {
      width: 480,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (alive) setDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [uri]);

  if (!uri) return null;
  const statusDetail = poolStore.pairingStatus;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur"
      onClick={() => poolStore.cancelPairing()}
    >
      <Card
        className="w-full max-w-sm border-l-2 border-l-secondary bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="pb-3 text-center">
          <CardTitle className="text-lg">Pair MyQRLWallet</CardTitle>
          <p className="text-xs text-muted-foreground">
            Scan with the mobile app, or use the wallet at{" "}
            <a
              href="https://qrlwallet.com"
              target="_blank"
              rel="noreferrer"
              className="text-blue-accent hover:underline"
            >
              qrlwallet.com
            </a>
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-center">
          {dataUrl ? (
            <img
              src={dataUrl}
              alt="qrlconnect pairing QR code"
              className="mx-auto h-60 w-60 rounded-md bg-white p-2"
            />
          ) : (
            <p className="text-sm text-muted-foreground">Generating…</p>
          )}
          {statusDetail ? (
            <p className="text-xs text-muted-foreground">status: {statusDetail}</p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={uri} title="Opens the MyQRLWallet desktop app if installed">
                <ExternalLink className="h-3.5 w-3.5" />
                Open in wallet
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(uri).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Copied!" : "Copy code"}
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Desktop wallet without the protocol handler? Copy the code and paste it under dApp
            Sessions in the wallet.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => void poolStore.newConnection()}
            >
              <RefreshCw className="h-3 w-3" />
              New connection
            </Button>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => poolStore.cancelPairing()}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
