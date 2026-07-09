/** Attempt to open a qrlconnect:// URI in the wallet app and report whether
 *  anything handled it. Unknown-protocol navigation fails silently on
 *  Android and with a blocking alert on iOS when the app is missing; when
 *  it IS installed the OS backgrounds the browser almost immediately. So:
 *  navigate, resolve true once the page hides, false after the timeout.
 *  Heuristic: treat false as "show a fallback", not proof the app is absent.
 *  Mirrors attemptWalletRedirect in @qrlwallet/connect (ships in the next
 *  SDK release; inline until then). */
export function attemptWalletRedirect(uri: string, timeoutMs = 1800): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (opened: boolean): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.clearTimeout(timer);
      resolve(opened);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") finish(true);
    };
    const onHide = (): void => {
      finish(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    const timer = window.setTimeout(() => {
      finish(false);
    }, timeoutMs);
    window.location.href = uri;
  });
}

export function appStoreUrl(): string {
  if (/android/i.test(navigator.userAgent)) {
    return "https://play.google.com/store/apps/details?id=com.chiefdg.myqrlwallet";
  }
  return "https://apps.apple.com/app/myqrlwallet/id6742219498";
}
