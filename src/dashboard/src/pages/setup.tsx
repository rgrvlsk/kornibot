import type { FormEvent, ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  loadSetupStatus,
  loadTelegramChats,
  updateGroupSettings,
  type QueryResult,
  type SetupStatusPayload,
  type TelegramChatSummary,
} from "../lib/api";
import { EmptyState, MetricRow, SectionCard, StatusNote } from "../routes";

type SetupPageProps = {
  onSetupComplete: () => Promise<void>;
};

type SetupState = {
  setup: QueryResult<SetupStatusPayload>;
  chats: QueryResult<{ items: TelegramChatSummary[] }>;
};

function formatChat(chat: TelegramChatSummary): string {
  return `${chat.title ?? "Sense titol"} · ${chat.chatId}`;
}

function parseChatId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function SetupPage(props: SetupPageProps): ReactElement {
  const [state, setState] = useState<SetupState | null>(null);
  const [auditChatId, setAuditChatId] = useState("");
  const [caaChatId, setCaaChatId] = useState("");
  const [saveIssue, setSaveIssue] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function refresh(): Promise<void> {
    const [setup, chats] = await Promise.all([
      loadSetupStatus(),
      loadTelegramChats(),
    ]);
    setState({ setup, chats });
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!state?.setup.data) {
      return;
    }

    setAuditChatId(String(state.setup.data.auditChatId));
    setCaaChatId(state.setup.data.caaChatId ? String(state.setup.data.caaChatId) : "");
  }, [state?.setup.data]);

  const chatOptions = useMemo(() => {
    const chats = state?.chats.data.items ?? [];
    const knownIds = new Set(chats.map((chat) => chat.chatId));
    const setup = state?.setup.data;
    const injected: TelegramChatSummary[] = [];

    if (setup && !knownIds.has(setup.auditChatId)) {
      injected.push({
        chatId: setup.auditChatId,
        title: "Policornis inicial",
        type: "supergroup",
        firstSeenAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        lastUpdateId: 0,
        isAuditChat: true,
        isCaaChat: false,
      });
    }

    return [...injected, ...chats];
  }, [state]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextAuditChatId = parseChatId(auditChatId);
    const nextCaaChatId = parseChatId(caaChatId);
    if (!nextAuditChatId || !nextCaaChatId) {
      setSaveIssue("Tria Policornis i CAA.");
      return;
    }

    setIsSaving(true);
    try {
      await updateGroupSettings({
        auditChatId: nextAuditChatId,
        caaChatId: nextCaaChatId,
      });
      setSaveIssue(null);
      await props.onSetupComplete();
    } catch (error) {
      setSaveIssue(error instanceof Error ? error.message : "No s'ha pogut desar la configuracio.");
    } finally {
      setIsSaving(false);
    }
  }

  const setup = state?.setup.data;
  const issue = state?.setup.issue ?? state?.chats.issue;

  return (
    <main className="login-shell">
      <section className="setup-panel">
        <div className="login-copy">
          <p className="brand-kicker">Setup</p>
          <h1>Kornibot</h1>
          <p>Configura CAA i Policornis.</p>
        </div>
        <StatusNote issue={issue} />
        {saveIssue ? <div className="status-banner tone-warm">{saveIssue}</div> : null}
        <SectionCard title="Valors segurs">
          <div className="metric-stack">
            <MetricRow label="Audit inicial" value={String(setup?.safeEnv.initialAuditChatId ?? "-1002829359850")} tone="neutral" />
            <MetricRow label="Bootstrap" value={setup?.bootstrapSuperadminConfigured ? "configurat" : "pendent"} tone={setup?.bootstrapSuperadminConfigured ? "good" : "warm"} />
            <MetricRow label="Idioma" value={setup?.safeEnv.defaultLanguage ?? "ca"} tone="neutral" />
          </div>
        </SectionCard>
        <SectionCard title="Grups detectats">
          {chatOptions.length > 0 ? (
            <form className="settings-form" onSubmit={(event) => void handleSubmit(event)}>
              <label className="filter-field">
                <span className="label">Policornis</span>
                <select onChange={(event) => setAuditChatId(event.target.value)} value={auditChatId}>
                  {chatOptions.map((chat) => (
                    <option key={`audit-${chat.chatId}`} value={chat.chatId}>
                      {formatChat(chat)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span className="label">CAA</span>
                <select onChange={(event) => setCaaChatId(event.target.value)} value={caaChatId}>
                  <option value="">tria grup CAA</option>
                  {chatOptions.map((chat) => (
                    <option key={`caa-${chat.chatId}`} value={chat.chatId}>
                      {formatChat(chat)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button" disabled={isSaving} type="submit">
                Desa setup
              </button>
            </form>
          ) : (
            <EmptyState
              title="Sense grups observats"
              description="El bot ha de rebre almenys un update de CAA abans de poder seleccionar-lo."
            />
          )}
        </SectionCard>
      </section>
    </main>
  );
}
