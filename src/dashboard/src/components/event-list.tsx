import type { ReactElement } from "react";
import { Link } from "react-router-dom";

export type EventListItem = {
  id: string | number;
  eyebrow: string;
  title: string;
  body: string;
  meta: string[];
  href?: string;
};

export function EventList(props: {
  items: EventListItem[];
}): ReactElement {
  return (
    <div className="event-list">
      {props.items.map((item) => {
        const content = (
          <>
            <div className="event-row-heading">
              <span className="event-row-eyebrow">{item.eyebrow}</span>
              <h4>{item.title}</h4>
            </div>
            <p>{item.body}</p>
            <div className="event-row-meta">
              {item.meta.map((piece) => (
                <span key={piece}>{piece}</span>
              ))}
            </div>
          </>
        );

        return item.href ? (
          <Link className="event-row event-row-link" key={item.id} to={item.href}>
            {content}
          </Link>
        ) : (
          <article className="event-row" key={item.id}>
            {content}
          </article>
        );
      })}
    </div>
  );
}
