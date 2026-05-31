import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { Activity, CalendarDays, Settings, UsersRound } from "lucide-react";
import { matchPath, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { recordDashboardVisit } from "./lib/api";
import { MembersPage } from "./pages/members";
import { AlmanacPage } from "./pages/almanac";
import { ResumConceptsPage, ResumPage } from "./pages/resum-concepts";
import { SettingsPage } from "./pages/settings";
import { ThreadPage } from "./pages/thread";
import { UserProfilePage } from "./pages/user-profile";

type AppRoute = {
  path: string;
  navPath?: string;
  label: string;
  description: string;
  element: ReactElement;
  icon?: ReactElement;
};

const navigationRoutes: AppRoute[] = [
  {
    path: "/resum",
    navPath: "/resum",
    label: "Resum",
    description: "Pols del grup.",
    element: <ResumPage />,
    icon: <Activity aria-hidden="true" size={18} />,
  },
  {
    path: "/members",
    navPath: "/members",
    label: "Membres",
    description: "Directori Policornis.",
    element: <MembersPage />,
    icon: <UsersRound aria-hidden="true" size={18} />,
  },
  {
    path: "/almanac",
    navPath: "/almanac",
    label: "Almanac",
    description: "Aniversaris i targetes.",
    element: <AlmanacPage />,
    icon: <CalendarDays aria-hidden="true" size={18} />,
  },
  {
    path: "/settings",
    navPath: "/settings",
    label: "Settings",
    description: "Sistema i setup.",
    element: <SettingsPage />,
    icon: <Settings aria-hidden="true" size={18} />,
  },
];

const detailRoutes: AppRoute[] = [
  {
    path: "/threads/:chatId/:messageId",
    label: "Thread",
    description: "Context de missatge.",
    element: <ThreadPage />,
  },
  {
    path: "/users/:userId",
    label: "Perfil",
    description: "Activitat per membre.",
    element: <UserProfilePage />,
  },
  {
    path: "/resum-concepts/:variant",
    label: "Resum",
    description: "Conceptes visuals.",
    element: <ResumConceptsPage />,
  },
];

export const appRoutes: AppRoute[] = [
  ...navigationRoutes,
  ...detailRoutes,
];

export function AppNavigation(): ReactElement {
  return (
    <nav className="sidebar-nav" aria-label="Navegacio principal">
      {navigationRoutes.map((route) => (
        <NavLink
          key={route.path}
          className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
          to={route.navPath ?? route.path}
        >
          <span className="sidebar-link-icon">{route.icon}</span>
          <span className="sidebar-link-copy">
            <strong>{route.label}</strong>
            <span>{route.description}</span>
          </span>
        </NavLink>
      ))}
    </nav>
  );
}

export function AppRouteHeader(): ReactElement {
  const location = useLocation();
  const currentRoute = appRoutes.find((route) => (
    matchPath({ path: route.path, end: false }, location.pathname)
  )) ?? navigationRoutes[0];

  return (
    <div className="topbar-copy">
      <h1>{currentRoute.label}</h1>
    </div>
  );
}

export function DashboardAccessTracker(): null {
  const location = useLocation();
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastPathRef.current === location.pathname) {
      return;
    }

    lastPathRef.current = location.pathname;
    void recordDashboardVisit();
  }, [location.pathname]);

  return null;
}

export function AppRoutes(props: {
  onLogout: () => Promise<void>;
}): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/resum" />} />
      <Route path="/overview" element={<Navigate replace to="/resum" />} />
      <Route path="/activity" element={<Navigate replace to="/members" />} />
      <Route path="/feed" element={<Navigate replace to="/members" />} />
      <Route path="/search" element={<Navigate replace to="/members" />} />
      <Route path="/resum-concepts" element={<Navigate replace to="/resum-concepts/final" />} />
      {appRoutes.map((route) => (
        <Route
          key={route.path}
          path={route.path}
          element={route.path === "/settings" ? <SettingsPage onLogout={props.onLogout} /> : route.element}
        />
      ))}
    </Routes>
  );
}

export function RoutePage(props: {
  title: string;
  summary: string;
  children: ReactNode;
  aside?: ReactNode;
}): ReactElement {
  return (
    <div className="route-layout">
      <section className="route-main">
        {props.summary ? (
          <header className="route-header" aria-label={props.title}>
            <p>{props.summary}</p>
          </header>
        ) : null}
        {props.children}
      </section>
      {props.aside ? <aside className="route-aside">{props.aside}</aside> : null}
    </div>
  );
}

export function SectionCard(props: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="section-card">
      <header className="section-card-header">
        <h3>{props.title}</h3>
      </header>
      {props.children}
    </section>
  );
}

export function MetricRow(props: {
  label: string;
  value: string;
  tone: "neutral" | "good" | "warm";
}): ReactElement {
  return (
    <div className={`metric-row tone-${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

export function StatusNote(props: {
  issue?: string;
}): ReactElement | null {
  if (!props.issue) {
    return null;
  }

  return (
    <div className="status-note" role="status">
      <strong>Incidencia de dades</strong>
      <span>{props.issue}</span>
    </div>
  );
}

export function EmptyState(props: {
  title: string;
  description: string;
}): ReactElement {
  return (
    <div className="empty-state">
      <strong>{props.title}</strong>
      <p>{props.description}</p>
    </div>
  );
}
