import type { FormEvent, ReactElement } from "react";
import { useEffect, useState } from "react";
import { HashRouter } from "react-router-dom";
import { TelegramLogin } from "./components/telegram-login";
import {
  authenticateTelegram,
  authenticateDevAccess,
  getTelegramBotUsername,
  loadCurrentSession,
  loadSetupStatus,
  logoutSession,
  readStoredDevAccessKey,
  type DashboardSession,
  type QueryResult,
  type SetupStatusPayload,
} from "./lib/api";
import { SetupPage } from "./pages/setup";
import { AppNavigation, AppRouteHeader, AppRoutes, DashboardAccessTracker } from "./routes";
import { DashboardSessionProvider } from "./session";

type AuthStatus = "loading" | "ready" | "unauthenticated";

export function App(): ReactElement {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<DashboardSession | null>(null);
  const [setupResult, setSetupResult] = useState<QueryResult<SetupStatusPayload> | null>(null);
  const [setupIssue, setSetupIssue] = useState<string | null>(null);
  const [authIssue, setAuthIssue] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadCurrentSession().then((currentSession) => {
      if (cancelled) {
        return;
      }

      if (currentSession) {
        setSession(currentSession);
        setAuthStatus("ready");
        return;
      }

      setSession(null);
      setAuthStatus("unauthenticated");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setSetupResult(null);
      return;
    }

    void refreshSetupStatus();
  }, [session]);

  async function refreshSetupStatus(): Promise<void> {
    try {
      const result = await loadSetupStatus();
      setSetupResult(result);
      setSetupIssue(result.issue ?? null);
    } catch (error) {
      setSetupIssue(error instanceof Error ? error.message : "No s'ha pogut llegir el setup.");
    }
  }

  async function handleTelegramAuth(user: Record<string, unknown>): Promise<void> {
    try {
      const nextSession = await authenticateTelegram(user);
      setSession(nextSession);
      setAuthIssue(null);
      setAuthStatus("ready");
    } catch (error) {
      setAuthIssue(error instanceof Error ? error.message : "No s'ha pogut validar el login de Telegram.");
      setAuthStatus("unauthenticated");
    }
  }

  async function handleDevAccess(key: string): Promise<void> {
    try {
      const nextSession = await authenticateDevAccess(key);
      setSession(nextSession);
      setAuthIssue(null);
      setAuthStatus("ready");
    } catch (error) {
      setAuthIssue(error instanceof Error ? error.message : "No s'ha pogut validar l'acces dev.");
      setAuthStatus("unauthenticated");
    }
  }

  async function handleLogout(): Promise<void> {
    await logoutSession();
    setSession(null);
    setSetupResult(null);
    setAuthStatus("unauthenticated");
  }

  if (authStatus === "loading") {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="login-copy">
            <h1>CAA</h1>
            <p>Validant sessio.</p>
          </div>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <LoginGate
        authIssue={authIssue}
        onAuth={handleTelegramAuth}
        onDevAccess={handleDevAccess}
      />
    );
  }

  if (!setupResult) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="login-copy">
            <h1>Kornibot</h1>
            <p>Carregant setup.</p>
          </div>
          {setupIssue ? <p className="login-issue">{setupIssue}</p> : null}
        </section>
      </main>
    );
  }

  if (!setupResult.data.isComplete) {
    if (session.role === "superadmin") {
      return (
        <DashboardSessionProvider session={session}>
          <SetupPage onSetupComplete={refreshSetupStatus} />
        </DashboardSessionProvider>
      );
    }

    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="login-copy">
            <h1>Setup pendent</h1>
            <p>Superadmin ha de seleccionar CAA abans d'obrir el dashboard.</p>
          </div>
          <button className="quiet-button" onClick={() => void handleLogout()} type="button">
            Tanca sessio
          </button>
        </section>
      </main>
    );
  }

  return (
    <DashboardSessionProvider session={session}>
      <HashRouter>
        <DashboardAccessTracker />
        <div className="app-shell">
          <aside className="sidebar">
            <div className="brand-block">
              <h1>Kornibot</h1>
              <p>CAA audit</p>
            </div>
            <div className="sidebar-meta">
              <div>
                <span className="label">Policornis</span>
                <p>{setupResult.data.auditChatId}</p>
              </div>
              <div>
                <span className="label">CAA</span>
                <p>{setupResult.data.caaChatId}</p>
              </div>
            </div>
            <AppNavigation />
          </aside>
          <main className="main-shell">
            <header className="topbar">
              <AppRouteHeader />
            </header>
            <AppRoutes onLogout={handleLogout} />
          </main>
        </div>
      </HashRouter>
    </DashboardSessionProvider>
  );
}

function LoginGate(props: {
  authIssue: string | null;
  onAuth: (user: Record<string, unknown>) => Promise<void>;
  onDevAccess: (key: string) => Promise<void>;
}): ReactElement {
  const [devKey, setDevKey] = useState(() => readStoredDevAccessKey() ?? "");
  const [devBusy, setDevBusy] = useState(false);

  async function handleDevSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!devKey.trim()) {
      return;
    }

    setDevBusy(true);
    try {
      await props.onDevAccess(devKey.trim());
    } finally {
      setDevBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-copy">
          <p className="brand-kicker">Telegram auth gate</p>
          <h1>Acces CAA</h1>
          <p>Només membres del grup.</p>
          <div className="login-actions">
            <TelegramLogin botUsername={getTelegramBotUsername()} onAuth={props.onAuth} />
          </div>
          <details className="dev-access-gate">
            <summary>Dev access</summary>
            <form onSubmit={(event) => void handleDevSubmit(event)}>
              <input
                aria-label="Dev access key"
                autoComplete="one-time-code"
                onChange={(event) => setDevKey(event.target.value)}
                placeholder="key"
                type="password"
                value={devKey}
              />
              <button className="quiet-button" disabled={devBusy || !devKey.trim()} type="submit">
                Entra
              </button>
            </form>
          </details>
          {props.authIssue ? <p className="login-issue">{props.authIssue}</p> : null}
        </div>
        <div className="login-status">
          <section className="section-card">
            <header className="section-card-header">
              <h2>Acces</h2>
            </header>
            <div className="metric-stack">
              <div className="metric-row tone-neutral">
                <span>Identitat</span>
                <strong>Telegram</strong>
              </div>
              <div className="metric-row tone-good">
                <span>Grup</span>
                <strong>CAA</strong>
              </div>
              <div className="metric-row tone-warm">
                <span>Rol</span>
                <strong>caa_member</strong>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
