
  import { useEffect, useState } from "react";
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { initRedactMode, onRedactRemount } from "./app/hooks/useRedactMode";
  import "./styles/index.css";

  initRedactMode();

  // Redact mode is applied at the API boundary; toggling it remounts <App> so
  // every lens re-reads under the new setting (see useRedactMode.ts).
  function Root() {
    const [epoch, setEpoch] = useState(0);
    useEffect(() => onRedactRemount(() => setEpoch((value) => value + 1)), []);
    return <App key={epoch} />;
  }

  createRoot(document.getElementById("root")!).render(<Root />);
