import type { FormEvent, ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { LogOut, Save, RotateCcw } from "lucide-react";
import {
  loadAccessOverview,
  loadSettings,
  loadTelegramChats,
  resetAuditGroup,
  updateGroupSettings,
  updateMemberActivityThresholds,
  updateMessageRetention,
  type AccessOverviewPayload,
  type QueryResult,
  type SettingsPayload,
  type TelegramChatSummary,
} from "../lib/api";
import { useDashboardSession } from "../session";
import { EmptyState, MetricRow, RoutePage, SectionCard, StatusNote } from "../routes";

const RESET_CONFIRMATION = "PURGE AUDIT DATA";
const RETENTION_DECREASE_CONFIRMATION = "Si baixes els dies, els missatges mes antics s'esborraran per sempre. Espera el proper cron.";
const D1_FREE_ROWS_WRITTEN_DAILY = 100_000;
const R2_FREE_CLASS_A_MONTHLY = 1_000_000;
const R2_FREE_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;

type SettingsState = {
  settings: QueryResult<SettingsPayload>;
  chats: QueryResult<{ items: TelegramChatSummary[] }>;
  accessOverview: QueryResult<AccessOverviewPayload> | null;
};

function formatChat(chat: TelegramChatSummary): string {
  const tags = [
    chat.isAuditChat ? "Policornis" : null,
    chat.isCaaChat ? "CAA" : null,
  ].filter(Boolean);

  return `${chat.title ?? "Sense titol"} · ${chat.chatId}${tags.length ? ` · ${tags.join(", ")}` : ""}`;
}

function parseChatId(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("ca-ES").format(value);
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) {
    return `${new Intl.NumberFormat("ca-ES", { maximumFractionDigits: 1 }).format(value / (1024 * 1024 * 1024))} GB`;
  }

  if (value >= 1024 * 1024) {
    return `${new Intl.NumberFormat("ca-ES", { maximumFractionDigits: 1 }).format(value / (1024 * 1024))} MB`;
  }

  if (value >= 1024) {
    return `${new Intl.NumberFormat("ca-ES", { maximumFractionDigits: 1 }).format(value / 1024)} KB`;
  }

  return `${formatCount(value)} B`;
}

function percentOf(value: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }

  return Math.min(100, (value / limit) * 100);
}

function formatPercent(value: number, limit: number): string {
  const percent = percentOf(value, limit);
  if (percent > 0 && percent < 0.1) {
    return "<0,1%";
  }

  return `${new Intl.NumberFormat("ca-ES", { maximumFractionDigits: 1 }).format(percent)}%`;
}

function formatAccessDate(value: string): string {
  return new Intl.DateTimeFormat("ca-ES", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(new Date(value));
}

function formatAccessUser(item: AccessOverviewPayload["items"][number]): string {
  return item.username ? `@${item.username}` : String(item.userId);
}

function totalAuditRows(counts: SettingsPayload["auditDataCounts"]): number {
  return counts.rawEvents
    + counts.messages
    + counts.users
    + counts.mediaObjects
    + counts.membershipEvents
    + counts.membershipPeriods
    + counts.hourlyGroupMetrics
    + counts.hourlyUserMetrics
    + counts.monthlyUserSnapshots;
}

function UsageSparkBars(props: {
  values: number[];
}): ReactElement {
  const values = props.values.length > 0 ? props.values : Array.from({ length: 14 }, () => 0);
  const max = Math.max(1, ...values);

  return (
    <div className="usage-spark-bars" aria-hidden="true">
      {values.map((value, index) => (
        <i key={`${index}-${value}`} style={{ height: `${Math.max(8, (value / max) * 100)}%` }} />
      ))}
    </div>
  );
}

function UsageMonitorRow(props: {
  label: string;
  value: string;
  limitLabel: string;
  limitPercent: string;
  progress: number;
  trend: number[];
  monthToDate: string;
}): ReactElement {
  return (
    <div className="usage-monitor-row">
      <div className="usage-monitor-head">
        <span>{props.label}</span>
        <strong>{props.value}</strong>
      </div>
      <UsageSparkBars values={props.trend} />
      <div className="usage-progress-track" aria-label={`${props.label} ${props.limitPercent}`}>
        <i style={{ width: `${props.progress}%` }} />
      </div>
      <div className="usage-monitor-foot">
        <span>{props.monthToDate}</span>
        <span>{props.limitPercent} · {props.limitLabel}</span>
      </div>
    </div>
  );
}

export function SettingsPage(props: {
  onLogout?: () => Promise<void>;
}): ReactElement {
  const session = useDashboardSession();
  const [state, setState] = useState<SettingsState | null>(null);
  const [caaChatId, setCaaChatId] = useState("");
  const [resetChatId, setResetChatId] = useState("");
  const [goodHours, setGoodHours] = useState("24");
  const [warmHours, setWarmHours] = useState("168");
  const [retentionDays, setRetentionDays] = useState("7");
  const [confirmation, setConfirmation] = useState("");
  const [saveIssue, setSaveIssue] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const [settings, chats, accessOverview] = await Promise.all([
      loadSettings(),
      loadTelegramChats(),
      loadAccessOverview(),
    ]);
    setState({ settings, chats, accessOverview });
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const groups = state?.settings.data.groups;
    if (!groups) {
      return;
    }

    setCaaChatId(groups.caaChatId ? String(groups.caaChatId) : "");
    setResetChatId(String(groups.auditChatId));
    setGoodHours(String(state.settings.data.memberActivityThresholds.goodHours));
    setWarmHours(String(state.settings.data.memberActivityThresholds.warmHours));
    setRetentionDays(String(state.settings.data.messageRetention.detailDays));
  }, [state?.settings.data.groups, state?.settings.data.memberActivityThresholds, state?.settings.data.messageRetention]);

  const settings = state?.settings.data;
  const chats = state?.chats.data.items ?? [];
  const isSuperadmin = session.role === "superadmin";
  const chatOptions = useMemo(() => {
    const groups = settings?.groups;
    const knownIds = new Set(chats.map((chat) => chat.chatId));
    const injected: TelegramChatSummary[] = [];

    if (groups && !knownIds.has(groups.auditChatId)) {
      injected.push({
        chatId: groups.auditChatId,
        title: "Policornis configurat",
        type: "supergroup",
        firstSeenAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        lastUpdateId: 0,
        isAuditChat: true,
        isCaaChat: false,
      });
    }

    return [...injected, ...chats];
  }, [chats, settings?.groups]);

  async function handleGroupSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextCaaChatId = parseChatId(caaChatId);
    if (!settings || !nextCaaChatId) {
      setSaveIssue("Tria CAA.");
      setSaveMessage(null);
      return;
    }

    try {
      const nextSettings = await updateGroupSettings({
        auditChatId: settings.groups.auditChatId,
        caaChatId: nextCaaChatId,
      });
      setState((current) => current ? {
        ...current,
        settings: {
          data: nextSettings,
        },
      } : current);
      setSaveIssue(null);
      setSaveMessage("Grups actualitzats.");
    } catch (error) {
      setSaveMessage(null);
      setSaveIssue(error instanceof Error ? error.message : "No s'han pogut desar els grups.");
    }
  }

  async function handleResetSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextAuditChatId = parseChatId(resetChatId);
    if (!nextAuditChatId) {
      setSaveIssue("Tria el nou grup auditat.");
      setSaveMessage(null);
      return;
    }

    try {
      const reset = await resetAuditGroup({
        nextAuditChatId,
        confirmation,
      });
      setSaveIssue(null);
      setSaveMessage(`Reset complet. Media R2 esborrada: ${reset.deletedMediaObjects}.`);
      setConfirmation("");
      await refresh();
    } catch (error) {
      setSaveMessage(null);
      setSaveIssue(error instanceof Error ? error.message : "No s'ha pogut executar el reset.");
    }
  }

  async function handleThresholdSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextGoodHours = Number(goodHours);
    const nextWarmHours = Number(warmHours);

    try {
      const nextSettings = await updateMemberActivityThresholds({
        goodHours: nextGoodHours,
        warmHours: nextWarmHours,
      });
      setState((current) => current ? {
        ...current,
        settings: {
          data: nextSettings,
        },
      } : current);
      setSaveIssue(null);
      setSaveMessage("Llindars actualitzats.");
    } catch (error) {
      setSaveMessage(null);
      setSaveIssue(error instanceof Error ? error.message : "No s'han pogut desar els llindars.");
    }
  }

  async function handleRetentionSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextRetentionDays = Number(retentionDays);
    if (!Number.isSafeInteger(nextRetentionDays)) {
      setSaveMessage(null);
      setSaveIssue("Dies no valid.");
      return;
    }

    if (settings && nextRetentionDays < settings.messageRetention.detailDays) {
      const confirmed = window.confirm(RETENTION_DECREASE_CONFIRMATION);
      if (!confirmed) {
        return;
      }
    }

    try {
      const nextSettings = await updateMessageRetention({
        detailDays: nextRetentionDays,
      });
      setState((current) => current ? {
        ...current,
        settings: {
          data: nextSettings,
        },
      } : current);
      setSaveIssue(null);
      setSaveMessage("Retencio actualitzada. Avis enviat a CAA.");
    } catch (error) {
      setSaveMessage(null);
      setSaveIssue(error instanceof Error ? error.message : "No s'ha pogut desar la retencio.");
    }
  }

  const counts = settings?.auditDataCounts;
  const usage = settings?.auditUsage;
  const accessItems = state?.accessOverview?.data.items ?? [];
  const auditRows = counts ? totalAuditRows(counts) : 0;
  const hasUsageSeries = Boolean(usage && usage.daily.length > 0);
  const d1MonthRows = usage
    ? usage.monthToDate.rawEvents + usage.monthToDate.messages + usage.monthToDate.mediaObjects
    : 0;
  const usageWarnings = useMemo(() => {
    const items: string[] = [];
    if (!settings?.groups.caaChatId) {
      items.push("CAA pendent");
    }
    if (counts && counts.rawEvents === 0) {
      items.push("Sense events auditats");
    }
    if (settings && !settings.safeEnv.hasCorsAllowedOrigins) {
      items.push("CORS env no definit");
    }
    return items;
  }, [counts, settings]);
  const sessionCard = (
    <SectionCard title="Sessio">
      <div className="metric-stack">
        <MetricRow label="Rol" value={session.role} tone={isSuperadmin ? "warm" : "good"} />
        <MetricRow label="Privilegis" value={settings?.canManagePrivilegedSettings ? "superadmin" : "lectura"} tone={settings?.canManagePrivilegedSettings ? "warm" : "neutral"} />
        <MetricRow label="Auth" value="Telegram Login" tone="good" />
      </div>
      {props.onLogout ? (
        <button className="quiet-button session-logout-button" onClick={() => void props.onLogout?.()} type="button">
          <LogOut aria-hidden="true" size={16} />
          Tanca sessio
        </button>
      ) : null}
    </SectionCard>
  );

  return (
    <RoutePage
      title="Settings"
      summary="Estat segur per CAA; grups i reset nomes per superadmin."
    >
      <StatusNote issue={state?.settings.issue ?? state?.chats.issue} />
      {saveIssue ? <div className="status-banner tone-warm">{saveIssue}</div> : null}
      {saveMessage ? <div className="status-banner tone-good">{saveMessage}</div> : null}
      {sessionCard}
      <div className="metric-grid">
        <SectionCard title="Grups">
          <div className="metric-stack">
            <MetricRow label="Policornis" value={String(settings?.groups.auditChatId ?? "-")} tone="neutral" />
            <MetricRow label="CAA" value={settings?.groups.caaChatId ? String(settings.groups.caaChatId) : "pendent"} tone={settings?.groups.caaChatId ? "good" : "warm"} />
            <MetricRow label="Detectats" value={String(chats.length)} tone="neutral" />
          </div>
        </SectionCard>
        <SectionCard title="Env segur">
          <div className="metric-stack">
            <MetricRow label="Audit inicial" value={String(settings?.safeEnv.initialAuditChatId ?? "-1002829359850")} tone="neutral" />
            <MetricRow label="Idioma" value={settings?.safeEnv.defaultLanguage ?? "ca"} tone="neutral" />
            <MetricRow label="Timezone" value={settings?.safeEnv.defaultTimezone ?? "Europe/Madrid"} tone="neutral" />
          </div>
        </SectionCard>
      </div>
      <SectionCard title="Dades actuals">
        {counts && usage ? (
          <div className="usage-monitor">
            <UsageMonitorRow
              label="D1 rows locals"
              value={formatCount(auditRows)}
              limitLabel="100k writes/dia"
              limitPercent={formatPercent(hasUsageSeries ? d1MonthRows : auditRows, D1_FREE_ROWS_WRITTEN_DAILY)}
              monthToDate={hasUsageSeries ? `${formatCount(d1MonthRows)} MTD` : "serie pendent"}
              progress={percentOf(hasUsageSeries ? d1MonthRows : auditRows, D1_FREE_ROWS_WRITTEN_DAILY)}
              trend={usage.daily.map((point) => point.rawEvents + point.messages + point.mediaObjects)}
            />
            <UsageMonitorRow
              label="Raw events"
              value={formatCount(counts.rawEvents)}
              limitLabel="100k writes/dia"
              limitPercent={formatPercent(hasUsageSeries ? usage.monthToDate.rawEvents : counts.rawEvents, D1_FREE_ROWS_WRITTEN_DAILY)}
              monthToDate={hasUsageSeries ? `${formatCount(usage.monthToDate.rawEvents)} MTD` : "serie pendent"}
              progress={percentOf(hasUsageSeries ? usage.monthToDate.rawEvents : counts.rawEvents, D1_FREE_ROWS_WRITTEN_DAILY)}
              trend={usage.daily.map((point) => point.rawEvents)}
            />
            <UsageMonitorRow
              label="Missatges"
              value={formatCount(counts.messages)}
              limitLabel="100k writes/dia"
              limitPercent={formatPercent(hasUsageSeries ? usage.monthToDate.messages : counts.messages, D1_FREE_ROWS_WRITTEN_DAILY)}
              monthToDate={hasUsageSeries ? `${formatCount(usage.monthToDate.messages)} MTD` : "serie pendent"}
              progress={percentOf(hasUsageSeries ? usage.monthToDate.messages : counts.messages, D1_FREE_ROWS_WRITTEN_DAILY)}
              trend={usage.daily.map((point) => point.messages)}
            />
            <UsageMonitorRow
              label="R2 storage"
              value={formatBytes(counts.mediaBytes)}
              limitLabel="10GB gratis"
              limitPercent={formatPercent(counts.mediaBytes, R2_FREE_STORAGE_BYTES)}
              monthToDate={hasUsageSeries ? `${formatBytes(usage.monthToDate.mediaBytes)} MTD` : "serie pendent"}
              progress={percentOf(counts.mediaBytes, R2_FREE_STORAGE_BYTES)}
              trend={usage.daily.map((point) => point.mediaBytes)}
            />
            <UsageMonitorRow
              label="R2 objectes"
              value={formatCount(counts.mediaObjects)}
              limitLabel="1M Class A/mes"
              limitPercent={formatPercent(hasUsageSeries ? usage.monthToDate.mediaObjects : counts.mediaObjects, R2_FREE_CLASS_A_MONTHLY)}
              monthToDate={hasUsageSeries ? `${formatCount(usage.monthToDate.mediaObjects)} MTD` : "serie pendent"}
              progress={percentOf(hasUsageSeries ? usage.monthToDate.mediaObjects : counts.mediaObjects, R2_FREE_CLASS_A_MONTHLY)}
              trend={usage.daily.map((point) => point.mediaObjects)}
            />
            <p className="usage-monitor-note">
              Percentatges locals contra limits gratis Cloudflare; facturacio real via analytics Cloudflare.
            </p>
          </div>
        ) : (
          <EmptyState title="Sense comptadors" description="El backend encara no ha retornat l'estat." />
        )}
      </SectionCard>
      <SectionCard title="Avisos">
        {usageWarnings.length > 0 ? (
          <div className="table-list">
            {usageWarnings.map((item) => (
              <div className="table-row compact-table-row" key={item}>
                <strong>{item}</strong>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sense avisos" description="Configuracio minima completa." />
        )}
      </SectionCard>
      <SectionCard title="Llindars membres">
        {isSuperadmin ? (
          <form className="settings-form" onSubmit={(event) => void handleThresholdSubmit(event)}>
            <label className="filter-field">
              <span className="label">Verd fins hores</span>
              <input
                min="1"
                onChange={(event) => setGoodHours(event.target.value)}
                type="number"
                value={goodHours}
              />
            </label>
            <label className="filter-field">
              <span className="label">Groc fins hores</span>
              <input
                min="2"
                onChange={(event) => setWarmHours(event.target.value)}
                type="number"
                value={warmHours}
              />
            </label>
            <button className="primary-button" type="submit">
              <Save aria-hidden="true" size={16} />
              Desa llindars
            </button>
          </form>
        ) : (
          <div className="metric-stack">
            <MetricRow label="Verd" value={`${settings?.memberActivityThresholds.goodHours ?? 24} h`} tone="good" />
            <MetricRow label="Groc" value={`${settings?.memberActivityThresholds.warmHours ?? 168} h`} tone="warm" />
          </div>
        )}
      </SectionCard>
      <SectionCard title="Retencio missatges">
        <form className="settings-form" onSubmit={(event) => void handleRetentionSubmit(event)}>
          <div className="status-banner tone-warm">
            Si baixes els dies, els missatges mes antics s'esborraran per sempre. El canvi s'aplica al proper cron.
          </div>
          <label className="filter-field">
            <span className="label">Dies amb detall</span>
            <input
              max="30"
              min="1"
              onChange={(event) => setRetentionDays(event.target.value)}
              type="number"
              value={retentionDays}
            />
          </label>
          <button className="primary-button" type="submit">
            <Save aria-hidden="true" size={16} />
            Desa retencio
          </button>
          <p className="usage-monitor-note">
            Cada canvi s'avisara al grup CAA.
          </p>
        </form>
      </SectionCard>
      <SectionCard title="Canvi de grups">
        {isSuperadmin ? (
          <form className="settings-form" onSubmit={(event) => void handleGroupSubmit(event)}>
            <div className="metric-row tone-neutral">
              <span>Policornis</span>
              <strong>{String(settings?.groups.auditChatId ?? "-")}</strong>
            </div>
            <label className="filter-field">
              <span className="label">CAA</span>
              <select onChange={(event) => setCaaChatId(event.target.value)} value={caaChatId}>
                <option value="">pendent</option>
                {chatOptions.map((chat) => (
                  <option key={`caa-${chat.chatId}`} value={chat.chatId}>
                    {formatChat(chat)}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="submit">
              <Save aria-hidden="true" size={16} />
              Desa grups
            </button>
          </form>
        ) : (
          <EmptyState title="Lectura CAA" description="Nomes superadmin pot canviar grups." />
        )}
      </SectionCard>
      <SectionCard title="Reset auditat">
        {isSuperadmin ? (
          <form className="settings-form" onSubmit={(event) => void handleResetSubmit(event)}>
            <div className="status-banner tone-warm">
              Esborra audit, membres, agregats i media R2 del grup auditat actual.
            </div>
            <label className="filter-field">
              <span className="label">Nou Policornis</span>
              <select onChange={(event) => setResetChatId(event.target.value)} value={resetChatId}>
                {chatOptions.map((chat) => (
                  <option key={`reset-${chat.chatId}`} value={chat.chatId}>
                    {formatChat(chat)}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span className="label">Confirmacio</span>
              <input
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={RESET_CONFIRMATION}
                value={confirmation}
              />
            </label>
            <button className="primary-button danger-button" disabled={confirmation !== RESET_CONFIRMATION} type="submit">
              <RotateCcw aria-hidden="true" size={16} />
              Executa reset
            </button>
          </form>
        ) : (
          <EmptyState title="Reset bloquejat" description="Aquest flux es reserva a superadmin." />
        )}
      </SectionCard>
      <SectionCard title="Accessos consola">
        {accessItems.length > 0 ? (
          <div className="table-list compact-access-list">
            {accessItems.map((item) => (
              <div className="table-row access-row" key={item.userId}>
                <div className="access-row-main">
                  <strong>{formatAccessUser(item)}</strong>
                  <span>{item.role}</span>
                </div>
                <div className="access-row-meta">
                  <time dateTime={item.latestAccessAt}>{formatAccessDate(item.latestAccessAt)}</time>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sense accessos" description="Encara no hi ha visites registrades." />
        )}
      </SectionCard>
    </RoutePage>
  );
}
