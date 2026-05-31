import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, ArrowLeft, CalendarDays, Clipboard, Clock3, Download, Gift, Hash, Heart, Loader2, MessageCircle, RefreshCw, Save, Shield, Trash2, Upload, UserRound } from "lucide-react";
import { ActivityHeatmap } from "../components/activity-heatmap";
import { MonthlyComparison } from "../components/monthly-comparison";
import { ReactionBreakdown } from "../components/reaction-breakdown";
import {
  loadApiAssetObjectUrl,
  buildApiAssetUrl,
  deleteUserBirthday,
  loadSettings,
  loadUserProfile,
  loadUsers,
  refreshMemberStatus,
  updateUserBirthday,
  uploadBirthdayCard,
  type BirthdayPreference,
  type QueryResult,
  type SettingsPayload,
  type UserListPayload,
  type UserProfilePayload,
} from "../lib/api";
import { EmptyState, RoutePage, StatusNote } from "../routes";
import { useDashboardSession } from "../session";
import { activityTone, formatRelativeActivity, initialsFor, memberStatusLabel } from "./members-utils";

function sumHourly(
  hourlyMetrics: UserProfilePayload["hourlyMetrics"],
  key: keyof UserProfilePayload["hourlyMetrics"][number],
): number {
  return hourlyMetrics.reduce((total, row) => total + Number(row[key]), 0);
}

function displayName(user: NonNullable<UserProfilePayload["user"]> | null, fallbackId: string): string {
  if (!user) {
    return `user ${fallbackId}`;
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return user.nickname || fullName || (user.username ? `@${user.username}` : `user ${user.userId}`);
}

function handleLabel(user: NonNullable<UserProfilePayload["user"]> | null): string {
  return user?.username ? `@${user.username}` : "sense usuari";
}

function formatDate(value: string | null | undefined, options: { includeTime?: boolean } = { includeTime: true }): string {
  if (!value) {
    return "-";
  }

  const formatOptions: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  };

  if (options.includeTime !== false) {
    formatOptions.hour = "2-digit";
    formatOptions.minute = "2-digit";
  }

  return new Intl.DateTimeFormat("ca-ES", formatOptions).format(new Date(value));
}

const KORNIBOT_IMAGE_PATH = "/assets/kornibot-profile.png";

function formatBirthday(birthday: BirthdayPreference | null | undefined): string {
  if (!birthday) {
    return "Sense aniversari";
  }

  const date = `${birthday.day}/${birthday.month}`;
  const now = new Date();
  const currentYear = now.getFullYear();
  const hasPassed = now.getMonth() + 1 > birthday.month || (now.getMonth() + 1 === birthday.month && now.getDate() >= birthday.day);
  const age = birthday.year ? ` · ${currentYear - birthday.year - (hasPassed ? 0 : 1)} anys` : "";
  return `${date}${birthday.year ? `/${birthday.year}` : ""}${age}`;
}

function maxDayForMonth(month: number): number {
  if (month === 2) {
    return 29;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function monthName(month: number): string {
  return new Intl.DateTimeFormat("ca-ES", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, month - 1, 1)));
}

function firstImageFromTransfer(items: DataTransferItemList | null): File | null {
  if (!items) {
    return null;
  }

  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }

  return null;
}

function buildBirthdayPrompt(name: string, birthday: BirthdayPreference | null | undefined, ideasText: string): string {
  const ideas = ideasText
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ") || birthday?.promptIdeas.join(", ") || "personal details from staff notes";

  return [
    `Birthday card for ${name}.`,
    "Include Kornibot, a colorful robotic unicorn mascot, as a friendly companion.",
    `Use these ideas: ${ideas}.`,
    "Use inspired-by language and do not copy protected characters directly.",
    "Warm Barcelona community birthday mood. No text-heavy layout.",
  ].join("\n");
}

function recentMetrics(hourlyMetrics: UserProfilePayload["hourlyMetrics"]): UserProfilePayload["hourlyMetrics"] {
  const sorted = [...hourlyMetrics].sort((left, right) => Date.parse(right.bucketHour) - Date.parse(left.bucketHour));
  const anchor = sorted[0] ? Date.parse(sorted[0].bucketHour) : Date.now();
  const start = anchor - 24 * 60 * 60 * 1000;
  return sorted.filter((row) => {
    const time = Date.parse(row.bucketHour);
    return time > start && time <= anchor;
  });
}

function ActivityBars(props: { tone: "blue" | "red" | "amber" }): ReactElement {
  return (
    <span className={`profile-chip-bars tone-${props.tone}`} aria-hidden="true">
      {[0.35, 0.55, 0.72, 0.9, 0.62].map((scale, index) => (
        <i key={index} style={{ height: `${Math.round(scale * 18)}px` }} />
      ))}
    </span>
  );
}

function ProfileSkeleton(): ReactElement {
  return (
    <main className="profile-detail profile-detail-skeleton" aria-label="Carregant perfil" aria-busy="true">
      <section className="profile-hero">
        <div className="profile-hero-top">
          <span className="profile-back skeleton-block" />
          <span className="skeleton-line skeleton-line-title" />
        </div>
        <div className="profile-identity">
          <span className="profile-photo skeleton-block" />
          <div className="profile-identity-copy">
            <span className="skeleton-line skeleton-line-strong" />
            <span className="skeleton-line skeleton-line-medium" />
            <span className="profile-badges">
              <span className="skeleton-pill" />
              <span className="skeleton-pill skeleton-pill-short" />
            </span>
            <span className="skeleton-line skeleton-line-short" />
          </div>
        </div>
        <div className="profile-quick-metrics">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index}>
              <span className="skeleton-icon" />
              <span className="skeleton-line skeleton-line-short" />
              <span className="skeleton-line skeleton-line-shorter" />
              <span className="profile-chip-bars">
                {[0, 1, 2].map((bar) => <i className="skeleton-bar" key={bar} />)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {Array.from({ length: 4 }, (_, index) => (
        <section className="profile-panel profile-panel-skeleton" key={index}>
          <span className="skeleton-line skeleton-line-medium" />
          <span className="skeleton-panel" />
        </section>
      ))}
    </main>
  );
}

function statusCheckLabel(status: string | null, active: boolean): string {
  if (status === "administrator") {
    return "admin";
  }

  if (status === "creator") {
    return "propietari";
  }

  if (!status) {
    return active ? "actiu" : "desconegut";
  }

  return memberStatusLabel(status).toLocaleLowerCase("ca-ES");
}

function profileMembershipLabel(status: string | null): string {
  if (status === "administrator" || status === "creator") {
    return statusCheckLabel(status, true);
  }

  return memberStatusLabel(status);
}

function BirthdayProfilePanel(props: {
  userId: string;
  name: string;
  birthday: BirthdayPreference | null | undefined;
  onReload: () => Promise<void>;
}): ReactElement {
  const [month, setMonth] = useState(() => String(props.birthday?.month ?? 1));
  const [day, setDay] = useState(() => String(props.birthday?.day ?? 1));
  const [year, setYear] = useState(() => props.birthday?.year ? String(props.birthday.year) : "");
  const [wantsAiCard, setWantsAiCard] = useState(() => props.birthday?.wantsAiCard ?? false);
  const [ideasText, setIdeasText] = useState(() => props.birthday?.promptIdeas.join("\n") ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMonth(String(props.birthday?.month ?? 1));
    setDay(String(props.birthday?.day ?? 1));
    setYear(props.birthday?.year ? String(props.birthday.year) : "");
    setWantsAiCard(props.birthday?.wantsAiCard ?? false);
    setIdeasText(props.birthday?.promptIdeas.join("\n") ?? "");
  }, [props.birthday]);

  useEffect(() => {
    const parsedMonth = Number(month);
    const parsedDay = Number(day);
    const maxDay = maxDayForMonth(parsedMonth);
    if (parsedDay > maxDay) {
      setDay(String(maxDay));
    }
  }, [day, month]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return undefined;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  function setPickedFile(nextFile: File | null): void {
    if (!nextFile) {
      return;
    }
    if (!nextFile.type.startsWith("image/")) {
      setIssue("El fitxer no es imatge.");
      return;
    }
    setIssue(null);
    setFile(nextFile);
  }

  async function saveBirthday(): Promise<void> {
    setBusy(true);
    try {
      await updateUserBirthday(props.userId, {
        month: Number(month),
        day: Number(day),
        year: year.trim() ? Number(year) : null,
        wantsAiCard,
        promptIdeas: ideasText
          .split(/[\n,;]+/g)
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setMessage("Aniversari desat.");
      setIssue(null);
      await props.onReload();
    } catch (error) {
      setMessage(null);
      setIssue(error instanceof Error ? error.message : "No s'ha pogut desar.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBirthday(): Promise<void> {
    setBusy(true);
    try {
      await deleteUserBirthday(props.userId);
      setMessage("Aniversari esborrat.");
      setIssue(null);
      await props.onReload();
    } catch (error) {
      setMessage(null);
      setIssue(error instanceof Error ? error.message : "No s'ha pogut esborrar.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadCustomCard(): Promise<void> {
    if (!file) {
      setIssue("Falta imatge.");
      return;
    }

    setBusy(true);
    try {
      await uploadBirthdayCard({
        scopeType: "member",
        userId: Number(props.userId),
        file,
      });
      setFile(null);
      setMessage("Targeta pujada.");
      setIssue(null);
      await props.onReload();
    } catch (error) {
      setMessage(null);
      setIssue(error instanceof Error ? error.message : "No s'ha pogut pujar.");
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(buildBirthdayPrompt(props.name, props.birthday, ideasText));
      setMessage("Prompt copiat.");
      setIssue(null);
    } catch {
      setIssue("Copia no disponible.");
    }
  }

  async function copyKornibotImage(): Promise<void> {
    try {
      if (!navigator.clipboard || !("ClipboardItem" in window)) {
        throw new Error("clipboard unavailable");
      }
      const response = await fetch(buildApiAssetUrl(KORNIBOT_IMAGE_PATH));
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setMessage("Kornibot copiat.");
      setIssue(null);
    } catch {
      setIssue("Copia no disponible. Baixa la imatge.");
    }
  }

  return (
    <section
      className="profile-panel birthday-profile-panel"
      onPaste={(event) => {
        const pastedFile = firstImageFromTransfer(event.clipboardData?.items ?? null);
        if (pastedFile) {
          event.preventDefault();
          setPickedFile(pastedFile);
        }
      }}
    >
      <div className="birthday-panel-head">
        <h2>Aniversari</h2>
        <span><Gift aria-hidden="true" size={16} /> {formatBirthday(props.birthday)}</span>
      </div>
      {issue ? <span className="profile-refresh-result tone-failed">{issue}</span> : null}
      {message ? <span className="profile-refresh-result tone-done">{message}</span> : null}
      <div className="birthday-form-grid">
        <label className="filter-field">
          <span>Mes</span>
          <select value={month} onChange={(event) => setMonth(event.target.value)}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{monthName(value)}</option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Dia</span>
          <select value={day} onChange={(event) => setDay(event.target.value)}>
            {Array.from({ length: maxDayForMonth(Number(month)) }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Any</span>
          <input inputMode="numeric" placeholder="opcional" value={year} onChange={(event) => setYear(event.target.value)} />
        </label>
      </div>
      <label className="birthday-toggle">
        <input checked={wantsAiCard} type="checkbox" onChange={(event) => setWantsAiCard(event.target.checked)} />
        Targeta AI
      </label>
      {wantsAiCard ? (
        <label className="filter-field">
          <span>Idees</span>
          <textarea value={ideasText} onChange={(event) => setIdeasText(event.target.value)} placeholder="series, llibres, hobbies" />
        </label>
      ) : null}
      <div className="profile-action-row">
        <button className="primary-button" disabled={busy} onClick={() => void saveBirthday()} type="button">
          <Save aria-hidden="true" size={17} />
          Desa
        </button>
        {props.birthday ? (
          <button className="quiet-button danger-button" disabled={busy} onClick={() => void deleteBirthday()} type="button">
            <Trash2 aria-hidden="true" size={17} />
            Esborra
          </button>
        ) : null}
      </div>
      {wantsAiCard ? (
        <div className="birthday-card-tools">
          <button className="quiet-button" onClick={() => void copyPrompt()} type="button">
            <Clipboard aria-hidden="true" size={17} />
            Copia prompt
          </button>
          <button className="quiet-button" onClick={() => void copyKornibotImage()} type="button">
            <Clipboard aria-hidden="true" size={17} />
            Copia Kornibot
          </button>
          <a className="quiet-button" download href={buildApiAssetUrl(KORNIBOT_IMAGE_PATH)}>
            <Download aria-hidden="true" size={17} />
            Baixa
          </a>
        </div>
      ) : null}
      <div className="birthday-upload-row">
        <label
          className={`birthday-dropzone${previewUrl ? " has-preview" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setPickedFile(event.dataTransfer.files[0] ?? null);
          }}
        >
          {previewUrl ? <img alt="" src={previewUrl} /> : <Upload aria-hidden="true" size={24} />}
          <span>{file?.name ?? (props.birthday?.customCard ? `Feta #${props.birthday.customCard.id}` : "Puja custom")}</span>
          <input accept="image/*" type="file" onChange={(event) => setPickedFile(event.target.files?.[0] ?? null)} />
        </label>
        <button className="quiet-button" disabled={!file || busy} onClick={() => void uploadCustomCard()} type="button">
          <Upload aria-hidden="true" size={17} />
          Pujar
        </button>
      </div>
    </section>
  );
}

export function UserProfilePage(): ReactElement {
  const session = useDashboardSession();
  const params = useParams();
  const userId = params.userId ?? "4488129";
  const [result, setResult] = useState<QueryResult<UserProfilePayload> | null>(null);
  const [loadIssue, setLoadIssue] = useState<string | null>(null);
  const [listUser, setListUser] = useState<UserListPayload["items"][number] | null>(null);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [isPhotoLoading, setIsPhotoLoading] = useState(false);
  const [refreshState, setRefreshState] = useState<{
    status: "idle" | "running" | "done" | "failed";
    message: string | null;
  }>({ status: "idle", message: null });

  async function reloadProfile(): Promise<void> {
    try {
      const [profileResult, usersResult] = await Promise.all([
        loadUserProfile(userId),
        loadUsers(),
      ]);
      setResult(profileResult);
      setListUser(usersResult.data.items.find((item) => String(item.userId) === String(userId)) ?? null);
      setLoadIssue(profileResult.issue ?? usersResult.issue ?? null);
    } catch (error) {
      setResult(null);
      setListUser(null);
      setLoadIssue(error instanceof Error ? error.message : "No s'ha pogut carregar el perfil.");
      throw error;
    }
  }

  useEffect(() => {
    setResult(null);
    setListUser(null);
    setLoadIssue(null);
    void reloadProfile().catch(() => null);
    void loadSettings().then((settingsResult) => setSettings(settingsResult.data)).catch(() => null);
    setRefreshState({ status: "idle", message: null });
  }, [userId]);

  const profile = result?.data;
  const user = profile?.user ?? null;
  const profilePhotoUrl = user?.profilePhoto?.url ?? listUser?.profilePhoto?.url ?? null;

  useEffect(() => {
    document.body.classList.add("profile-route-mode");
    return () => {
      document.body.classList.remove("profile-route-mode");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadPhoto(): Promise<void> {
      if (!profilePhotoUrl) {
        setPhotoUrl(null);
        setIsPhotoLoading(false);
        return;
      }

      setPhotoUrl(null);
      setIsPhotoLoading(true);
      objectUrl = await loadApiAssetObjectUrl(profilePhotoUrl).catch(() => null);
      if (!cancelled) {
        setPhotoUrl(objectUrl);
        setIsPhotoLoading(false);
      } else if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }

    void loadPhoto();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [profilePhotoUrl]);

  const summary = useMemo(() => {
    if (!profile) {
      return null;
    }

    const lastMonth = profile.monthlySnapshots[0] ?? null;
    const last24h = recentMetrics(profile.hourlyMetrics);
    const sentMessages = lastMonth?.messagesSent ?? sumHourly(profile.hourlyMetrics, "messagesSent");
    const receivedReactions = lastMonth?.reactionsReceived ?? sumHourly(profile.hourlyMetrics, "reactionsReceived");

    return {
      last24hMessages: listUser?.messagesLast24h ?? sumHourly(last24h, "messagesSent"),
      last24hReactions: listUser?.reactionsGivenLast24h ?? sumHourly(last24h, "reactionsEmitted"),
      sentMessages,
      receivedReactions,
      emittedReactions: lastMonth?.reactionsEmitted ?? sumHourly(profile.hourlyMetrics, "reactionsEmitted"),
      averageReactions: lastMonth?.averageReactionsPerMessage ?? (sentMessages > 0 ? receivedReactions / sentMessages : 0),
      replies: sumHourly(profile.hourlyMetrics, "repliesSent"),
      edits: sumHourly(profile.hourlyMetrics, "editsMade"),
    };
  }, [listUser?.messagesLast24h, listUser?.reactionsGivenLast24h, profile]);

  const name = listUser?.nickname || displayName(user, userId);
  const relativeActivity = formatRelativeActivity(listUser?.lastSeenAt ?? user?.lastSeenAt ?? null);
  const isCaaMember = Boolean(listUser?.isCaaMember ?? user?.isCaaMember);
  const membershipStatus = listUser?.lastMembershipStatus ?? user?.lastMembershipStatus ?? null;
  const recencyTone = activityTone(listUser?.lastSeenAt ?? user?.lastSeenAt ?? null, settings?.memberActivityThresholds ?? {
    goodHours: 24,
    warmHours: 168,
  });
  const isInitialLoading = result === null && loadIssue === null;

  async function handleStatusRefresh(): Promise<void> {
    setRefreshState({ status: "running", message: null });

    try {
      const checked = await refreshMemberStatus(userId);
      await reloadProfile();
      const audit = statusCheckLabel(checked.auditStatus, checked.auditActive);
      const caa = checked.caaActive ? "CAA actiu" : "CAA fora";
      const suffix = checked.failed > 0 ? ` · ${checked.failed} error` : "";
      setRefreshState({
        status: "done",
        message: `Policornis: ${audit} · ${caa}${suffix}`,
      });
    } catch (error) {
      setRefreshState({
        status: "failed",
        message: error instanceof Error ? error.message : "No s'ha pogut comprovar.",
      });
    }
  }

  return (
    <RoutePage title="Perfil" summary="">
      <StatusNote issue={loadIssue ?? result?.issue} />
      {isInitialLoading ? (
        <ProfileSkeleton />
      ) : profile ? (
        <main className="profile-detail organic-fade-in">
          <section className="profile-hero">
            <div className="profile-hero-top">
              <Link className="profile-back" to="/members" aria-label="Tornar a membres">
                <ArrowLeft aria-hidden="true" size={28} />
              </Link>
              <h1>Perfil</h1>
            </div>
            <div className="profile-identity">
              <span className="profile-photo" aria-hidden="true">
                {isPhotoLoading ? <i className="profile-photo-loading skeleton-block" /> : null}
                {photoUrl ? (
                  <img className="organic-fade-in" alt="" onError={() => setPhotoUrl(null)} src={photoUrl} />
                ) : (
                  <span className={isPhotoLoading ? "is-muted" : ""}>{initialsFor(name)}</span>
                )}
              </span>
              <div className="profile-identity-copy">
                <strong>{name}</strong>
                <span>{listUser?.username ? `@${listUser.username}` : handleLabel(user)}</span>
                <div className="profile-badges">
                  <span className="profile-status-dot" />
                  <b>{profileMembershipLabel(membershipStatus)}</b>
                  {isCaaMember ? <em>CAA</em> : null}
                </div>
                <span className={`profile-recency tone-${recencyTone}`}>
                  <Clock3 aria-hidden="true" size={18} />
                  {relativeActivity}
                </span>
              </div>
            </div>
            <div className="profile-quick-metrics">
              <div>
                <MessageCircle aria-hidden="true" size={29} />
                <strong>{summary?.last24hMessages ?? 0}</strong>
                <span>msg 24h</span>
                <ActivityBars tone="blue" />
              </div>
              <div>
                <Heart aria-hidden="true" size={30} />
                <strong>{summary?.last24hReactions ?? 0}</strong>
                <span>reacc 24h</span>
                <ActivityBars tone="red" />
              </div>
              <div>
                <Activity aria-hidden="true" size={30} />
                <strong>{(summary?.averageReactions ?? 0).toFixed(1)}</strong>
                <span>mitjana</span>
                <ActivityBars tone="amber" />
              </div>
            </div>
          </section>

          <BirthdayProfilePanel
            birthday={profile.birthday ?? null}
            name={name}
            onReload={reloadProfile}
            userId={userId}
          />

          <section className="profile-panel profile-heatmap-panel">
            <h2>Finestra d'activitat <span>(ultims 7 dies)</span></h2>
            <ActivityHeatmap hourlyMetrics={profile.hourlyMetrics} />
          </section>

          <section className="profile-panel">
            <h2>Comparativa</h2>
            <MonthlyComparison hourlyMetrics={profile.hourlyMetrics} monthlySnapshots={profile.monthlySnapshots} />
          </section>

          <section className="profile-panel">
            <h2>Reaccions</h2>
            <ReactionBreakdown
              hourlyMetrics={profile.hourlyMetrics}
              monthlySnapshots={profile.monthlySnapshots}
              peerAverages={profile.peerAverages}
            />
          </section>

          <section className="profile-panel">
            <h2>Perfil i periodes</h2>
            <div className="profile-timeline">
              <span><UserRound aria-hidden="true" size={18} /> Membre des de <b>{formatDate(listUser?.lastJoinedAt ?? user?.lastJoinedAt ?? profile.membershipPeriods[0]?.joinedAt)}</b></span>
              <span><Hash aria-hidden="true" size={18} /> ID Telegram <b>{String(user?.telegramId ?? userId)}</b></span>
              <span><Shield aria-hidden="true" size={18} /> Estat <b>{profileMembershipLabel(membershipStatus)}{isCaaMember ? " · CAA" : ""}</b></span>
              <span><Clock3 aria-hidden="true" size={18} /> Ultima activitat <b>{relativeActivity}</b></span>
              <span><CalendarDays aria-hidden="true" size={18} /> Primera activitat <b>{formatDate(user?.firstSeenAt, { includeTime: false })}</b></span>
            </div>
          </section>

          {session.role === "superadmin" ? (
            <section className="profile-panel profile-status-refresh">
              <h2>Comprovacio Telegram</h2>
              <div className="profile-action-row">
                <button
                  className="primary-button"
                  disabled={refreshState.status === "running"}
                  onClick={() => void handleStatusRefresh()}
                  type="button"
                >
                  {refreshState.status === "running"
                    ? <Loader2 aria-hidden="true" size={18} />
                    : <RefreshCw aria-hidden="true" size={18} />}
                  Comprova ara
                </button>
                {refreshState.message ? (
                  <span className={`profile-refresh-result tone-${refreshState.status}`}>
                    {refreshState.message}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}
        </main>
      ) : (
        <section className="profile-detail organic-fade-in">
          <div className="profile-panel">
            <EmptyState
              title="Sense dades de perfil"
              description="Quan l'usuari tingui activitat projectada i agregada a D1, aquesta vista mostrara les seves metriques."
            />
          </div>
        </section>
      )}
    </RoutePage>
  );
}
