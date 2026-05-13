import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { EventList } from "../components/event-list";
import { loadThread, type QueryResult, type ThreadPayload } from "../lib/api";
import { EmptyState, MetricRow, RoutePage, SectionCard, StatusNote } from "../routes";

export function ThreadPage(): ReactElement {
  const params = useParams();
  const chatId = params.chatId ?? "-1002829359850";
  const messageId = params.messageId ?? "14602";
  const [result, setResult] = useState<QueryResult<ThreadPayload> | null>(null);

  useEffect(() => {
    void loadThread(chatId, messageId).then(setResult);
  }, [chatId, messageId]);

  const thread = result?.data;

  return (
    <RoutePage
      title="Reconstruccio de fil"
      summary="Vista de context per navegar el missatge arrel, les seves respostes, l'historial d'edicions i les reaccions actives."
      aside={(
        <SectionCard title="Context">
          <MetricRow label="Missatge arrel" value={messageId} tone="neutral" />
          <MetricRow label="Respostes" value={String(thread?.replies.length ?? 0)} tone="neutral" />
          <MetricRow
            label="Reaccions actives"
            value={String(thread?.reactions.filter((reaction) => reaction.isActive === 1).length ?? 0)}
            tone="good"
          />
        </SectionCard>
      )}
    >
      <StatusNote issue={result?.issue} />
      <SectionCard title="Missatge arrel">
        {thread?.root ? (
          <div className="thread-root">
            <strong>actor {thread.root.fromUserId ?? "anon"}</strong>
            <p>{thread.root.currentText ?? "Sense text indexable."}</p>
          </div>
        ) : (
          <EmptyState
            title="Fil no trobat"
            description="La projeccio encara no te el missatge arrel o el `message_id` no existeix a D1."
          />
        )}
      </SectionCard>
      <SectionCard title="Respostes del fil">
        {thread && thread.replies.length > 0 ? (
          <EventList
            items={thread.replies.map((reply) => ({
              id: reply.messageId,
              eyebrow: "reply",
              title: `message ${reply.messageId} · actor ${reply.fromUserId ?? "anon"}`,
              body: reply.currentText ?? "Sense text indexable.",
              meta: [new Date(reply.repliedAt).toLocaleString("ca-ES")],
            }))}
          />
        ) : (
          <EmptyState
            title="Sense respostes"
            description="Quan existeixin replies projectades a `message_replies`, apareixeran aquí."
          />
        )}
      </SectionCard>
      <div className="metric-grid">
        <SectionCard title="Versions">
          <div className="table-list">
            {(thread?.versions ?? []).map((version) => (
              <div className="table-row compact-table-row" key={version.versionNo}>
                <strong>v{version.versionNo}</strong>
                <span>{version.text ?? "Sense text"}</span>
                <span>{new Date(version.editedAt).toLocaleString("ca-ES")}</span>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Reaccions">
          <div className="table-list">
            {(thread?.reactions ?? []).map((reaction, index) => (
              <div className="table-row compact-table-row" key={`${reaction.reactionKey}-${index}`}>
                <strong>{reaction.reactionKey}</strong>
                <span>actor {reaction.reactorUserId ?? "anon"}</span>
                <span>{reaction.isActive === 1 ? "activa" : "retirada"}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </RoutePage>
  );
}
