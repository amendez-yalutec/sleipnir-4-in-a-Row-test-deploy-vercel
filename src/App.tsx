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
    <main className="page">
      <header>
        <h1>Cuatro en línea 8×7</h1>
        <p className="subtitle">Árbitro de prueba · Equipo 6</p>
      </header>

      <nav className="controls" aria-label="Secciones">
        <a className={`tab ${tab === "live" ? "active" : ""}`} href="#live">
          Tablero en vivo
        </a>
        <a className={`tab ${tab === "demo" ? "active" : ""}`} href="#demo">
          Jugar demo
        </a>
      </nav>

      {tab === "live" ? <Live /> : <Demo />}

      <footer>Árbitro de prueba que sigue el OpenAPI 1.0.1. No es el árbitro oficial del torneo.</footer>
    </main>
  );
}
