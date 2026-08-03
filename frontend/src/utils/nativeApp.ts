/**
 * MyQRLWallet native-app detection.
 *
 * The MyQRLWallet mobile app loads dApps in a WebView whose User-Agent
 * contains "MyQRLWallet". When QuantaPool runs inside it (or once the
 * myqrlwallet-connect SDK lands), the wallet provides the signing provider,
 * so UI like "install the extension" hints should be suppressed.
 */
export const isInNativeApp = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.includes("MyQRLWallet");
};
