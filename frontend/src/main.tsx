import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted variable fonts (CSP-safe, bundled by Vite): Sora = display,
// Instrument Sans = body, JetBrains Mono = data (addresses/amounts).
// Imported here, not in index.css, so Vite rewrites the woff2 asset URLs.
import "@fontsource-variable/sora/index.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
