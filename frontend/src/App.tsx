import { useEffect, useSyncExternalStore } from "react";
import { observer } from "mobx-react-lite";
import { BrowserRouter, Route, Routes } from "react-router";
import { AlertTriangle, X } from "lucide-react";
import { Header } from "@/components/Layout/Header";
import { Footer } from "@/components/Layout/Footer";
import { TxBanner } from "@/components/TxBanner";
import { WalletPickerModal } from "@/components/WalletPickerModal";
import { QrPairModal } from "@/components/QrPairModal";
import { RouteSeo } from "@/components/RouteSeo";
import { ApprovalHint } from "@/components/ApprovalHint";
import { StakePage } from "@/pages/StakePage";
import { WithdrawalsPage } from "@/pages/WithdrawalsPage";
import { StatsPage } from "@/pages/StatsPage";
import { HowItWorksPage } from "@/pages/HowItWorksPage";
import { LegalPage } from "@/pages/LegalPage";
import { useStore } from "@/stores/store";

const App = observer(() => {
  const { poolStore } = useStore();

  useEffect(() => {
    void poolStore.init();
  }, [poolStore]);

  const approvalPending = useSyncExternalStore(
    (listener) => poolStore.approvals.subscribe(listener),
    () => poolStore.approvals.pending(),
  );

  return (
    <BrowserRouter>
      <RouteSeo />
      <Header />

      {/* The wallet a request is waiting for, named where the user is
          looking: a prompt can sit unseen behind the wallet's toolbar icon
          or on a paired device. It only informs, so clicks pass through. */}
      <div className="pointer-events-none fixed right-4 top-20 z-50 w-[calc(100%-2rem)] max-w-sm">
        <ApprovalHint
          wallet={poolStore.approvalWallet}
          pending={approvalPending}
          className="rounded-xl bg-background [&:has([shown])]:shadow-xl"
        />
      </div>

      {poolStore.rpcError && (
        <div className="border-b border-destructive/40 bg-destructive/10">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {poolStore.rpcError}
          </div>
        </div>
      )}

      {poolStore.connectError && (
        <div className="border-b border-secondary/40 bg-secondary/10">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2 text-sm text-secondary">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{poolStore.connectError}</span>
            <button
              onClick={() => {
                poolStore.dismissConnectError();
              }}
              className="cursor-pointer hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-5xl flex-1 px-4">
        <Routes>
          <Route path="/" element={<StakePage />} />
          <Route path="/withdrawals" element={<WithdrawalsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/legal" element={<LegalPage />} />
          <Route path="*" element={<StakePage />} />
        </Routes>
      </main>

      <Footer />
      <TxBanner />
      <WalletPickerModal />
      <QrPairModal />
    </BrowserRouter>
  );
});

export default App;
