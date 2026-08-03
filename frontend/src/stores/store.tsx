import { createContext, useContext } from "react";
import { configure } from "mobx";
import { PoolStore } from "./poolStore";

configure({
  enforceActions: "never",
  useProxies: "always",
});

class RootStore {
  poolStore = new PoolStore();
}

// Persist the store across Vite HMR reloads (same pattern as myqrlwallet).
declare global {
  interface Window {
    __QUANTAPOOL_STORE__?: RootStore;
  }
}

function getRootStore(): RootStore {
  if (typeof window === "undefined") return new RootStore();
  if (!window.__QUANTAPOOL_STORE__) {
    window.__QUANTAPOOL_STORE__ = new RootStore();
  }
  return window.__QUANTAPOOL_STORE__;
}

const StoreContext = createContext<RootStore>(getRootStore());

export const useStore = () => useContext(StoreContext);
