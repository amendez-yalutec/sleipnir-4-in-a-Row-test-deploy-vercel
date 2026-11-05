import { useEffect, useState } from "react";
import Demo from "./Demo";
import Live from "./Live";

type Tab = "live" | "demo";
const tabFromHash = (): Tab => (window.location.hash === "#demo" ? "demo" : "live");

export default function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">
              <i className="p1" />
              <i className="p2" />
            </span>
            Árbitro de prueba <span className="brand-sep">·</span> Cuatro en línea 8×7
          </span>
          <nav className="topnav" aria-label="Secciones">
            <a className={tab === "live" ? "active" : ""} href="#live">
              En vivo
            </a>
            <a className={tab === "demo" ? "active" : ""} href="#demo">
              Jugar demo
            </a>
          </nav>
        </div>
      </header>

      <main className={tab === "live" ? "shell" : "page"}>
        {tab === "live" ? (
          <Live />
        ) : (
          <>
            <h1>Cuatro en línea 8×7</h1>
            <Demo />
          </>
        )}
        <footer>Árbitro de prueba que sigue el OpenAPI 1.0.1. No es el árbitro oficial del torneo.</footer>
      </main>
    </>
  );
}
