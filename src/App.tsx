import { useEffect, useState } from "react";
import Admin from "./Admin";
import Demo from "./Demo";
import Live from "./Live";
import MyTeam from "./MyTeam";

type Tab = "live" | "team" | "admin" | "demo";
const TABS: { id: Tab; label: string }[] = [
  { id: "live", label: "En vivo" },
  { id: "team", label: "Mi equipo" },
  { id: "admin", label: "Admin" },
  { id: "demo", label: "Jugar demo" },
];
const tabFromHash = (): Tab => TABS.find((t) => `#${t.id}` === window.location.hash)?.id ?? "live";

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
            {TABS.map((t) => (
              <a key={t.id} className={tab === t.id ? "active" : ""} href={`#${t.id}`}>
                {t.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className={tab === "demo" ? "page" : "shell"}>
        {tab === "live" && <Live />}
        {tab === "team" && (
          <section className="lv">
            <MyTeam />
          </section>
        )}
        {tab === "admin" && (
          <section className="lv">
            <Admin />
          </section>
        )}
        {tab === "demo" && (
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
