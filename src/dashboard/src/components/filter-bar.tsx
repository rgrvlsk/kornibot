import type { ReactElement, ReactNode } from "react";

export function FilterBar(props: {
  children: ReactNode;
  actions?: ReactNode;
}): ReactElement {
  return (
    <section className="filter-bar">
      <div className="filter-grid">{props.children}</div>
      {props.actions ? <div className="filter-actions">{props.actions}</div> : null}
    </section>
  );
}

export function FilterField(props: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <label className="filter-field">
      <span className="label">{props.label}</span>
      {props.children}
    </label>
  );
}
