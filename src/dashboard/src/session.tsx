import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import type { DashboardSession } from "./lib/api";

const DashboardSessionContext = createContext<DashboardSession | null>(null);

export function DashboardSessionProvider(props: {
  session: DashboardSession;
  children: ReactNode;
}): ReactElement {
  return (
    <DashboardSessionContext.Provider value={props.session}>
      {props.children}
    </DashboardSessionContext.Provider>
  );
}

export function useDashboardSession(): DashboardSession {
  const session = useContext(DashboardSessionContext);

  if (!session) {
    throw new Error("dashboard session is not available");
  }

  return session;
}
