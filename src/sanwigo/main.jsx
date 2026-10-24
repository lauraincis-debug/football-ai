import React from "react";
import ReactDOM from "react-dom/client";
import SanwiGoApp from "./SanwiGoApp.jsx";
import "./styles.css";

// Même patron que src/cloe-standalone/main.jsx et src/main.jsx du projet :
// application autonome partageant l'infrastructure React/Vite/PWA existante.
if ("serviceWorker" in navigator && !import.meta.env.PROD) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
}

ReactDOM.createRoot(document.getElementById("sanwigo-root")).render(
  <React.StrictMode>
    <SanwiGoApp />
  </React.StrictMode>
);
