import type { CSSProperties, Dispatch, FormEvent, ReactElement, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, CalendarDays, Check, Clipboard, Crown, Download, EyeOff, Globe2, Image, MoreVertical, Pencil, Plus, Save, SlidersHorizontal, Trash2, Upload, UserRound, X } from "lucide-react";
import {
  buildApiAssetUrl,
  createBirthdayWindow,
  deleteBirthdayWindow,
  loadBirthdayAlmanac,
  loadBirthdayCardImageObjectUrl,
  loadBirthdayCards,
  loadBirthdayWindows,
  loadUsers,
  updateBirthdayCard,
  updateBirthdayWindow,
  uploadBirthdayCard,
  type BirthdayAlmanacPayload,
  type BirthdayCard,
  type BirthdayCardsPayload,
  type BirthdayWindow,
  type QueryResult,
  type UserListPayload,
} from "../lib/api";
import { EmptyState, RoutePage, StatusNote } from "../routes";
import { addDaysToDateKey, birthdayPeriodFromDateFieldChange, formatMonthDayInput, mondayFirstMonthOffset, randomBirthdayWindowColor } from "./birthday-utils";

const KORNIBOT_IMAGE_PATH = "/assets/kornibot-profile.png";
const CARD_PAGE_SIZE = 60;

type AlmanacState = {
  almanac: QueryResult<BirthdayAlmanacPayload>;
  windows: QueryResult<{ windows: BirthdayWindow[] }>;
  cards: QueryResult<BirthdayCardsPayload>;
  users: QueryResult<UserListPayload>;
};

type UploadState = {
  scopeType: BirthdayCard["scopeType"];
  windowId: string;
  userId: string;
  file: File | null;
};

type WindowDraft = {
  label: string;
  startsOn: string;
  endsOn: string;
  color: string;
};

type ManagerTab = "images" | "seasons" | "kornibot";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateKeyParts(value: string): { year: number; month: number; day: number } {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat("ca-ES", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("ca-ES", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatBytes(value: number | null): string {
  if (!value) {
    return "-";
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function memberName(user: UserListPayload["items"][number] | undefined): string {
  if (!user) {
    return "membre";
  }

  return user.nickname || (user.username ? `@${user.username}` : `#${user.userId}`);
}

function scopeLabel(card: BirthdayCard, windows: BirthdayWindow[], users: UserListPayload["items"]): string {
  if (card.scopeType === "global") {
    return "Global";
  }

  if (card.scopeType === "window") {
    return windows.find((window) => window.id === card.windowId)?.label ?? `Temporada #${card.windowId}`;
  }

  return memberName(users.find((user) => user.userId === card.userId));
}

function stateLabel(state: BirthdayCard["state"]): string {
  if (state === "available") return "Disponible";
  if (state === "used") return "Usada";
  if (state === "archived") return "Arxivada";
  return "Aturada";
}

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return undefined;
    }

    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  return url;
}

function buildMonths(from: string): Date[] {
  const start = new Date(`${from}T00:00:00.000Z`);
  return Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1)));
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

export function AlmanacPage(): ReactElement {
  const [state, setState] = useState<AlmanacState | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [isLoadingMoreCards, setIsLoadingMoreCards] = useState(false);
  const [managerTab, setManagerTab] = useState<ManagerTab>("images");
  const [upload, setUpload] = useState<UploadState>({
    scopeType: "global",
    windowId: "",
    userId: "",
    file: null,
  });
  const [draft, setDraft] = useState<WindowDraft>({
    label: "",
    startsOn: todayKey(),
    endsOn: addDaysToDateKey(todayKey(), 6),
    color: randomBirthdayWindowColor(),
  });

  async function refresh(): Promise<void> {
    const [almanac, windows, cards, users] = await Promise.all([
      loadBirthdayAlmanac(12),
      loadBirthdayWindows(),
      loadBirthdayCards({ limit: CARD_PAGE_SIZE }),
      loadUsers(),
    ]);
    setState({ almanac, windows, cards, users });
    setIssue(almanac.issue ?? windows.issue ?? cards.issue ?? users.issue ?? null);
  }

  async function loadMoreCards(): Promise<void> {
    const nextCursor = state?.cards.data.nextCursor ?? null;
    if (nextCursor === null || isLoadingMoreCards) {
      return;
    }

    setIsLoadingMoreCards(true);
    try {
      const next = await loadBirthdayCards({ cursor: nextCursor, limit: CARD_PAGE_SIZE });
      setState((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          cards: {
            data: {
              cards: [...current.cards.data.cards, ...next.data.cards],
              nextCursor: next.data.nextCursor,
            },
          },
        };
      });
      setIssue(next.issue ?? null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "No s'han pogut carregar mes imatges.");
    } finally {
      setIsLoadingMoreCards(false);
    }
  }

  useEffect(() => {
    void refresh().catch((error) => setIssue(error instanceof Error ? error.message : "No s'ha pogut carregar."));
  }, []);

  const almanac = state?.almanac.data ?? null;
  const windows = state?.windows.data.windows ?? [];
  const activeWindows = almanac?.windows ?? [];
  const cards = state?.cards.data.cards ?? [];
  const cardsNextCursor = state?.cards.data.nextCursor ?? null;
  const users = state?.users.data.items ?? [];
  const previewUrl = useObjectUrl(upload.file);
  const windowOptions = activeWindows.length > 0 ? activeWindows : windows.filter((window) => window.enabled);
  const memberOptions = users.filter((user) => user.lastMembershipStatus !== "left" && user.lastMembershipStatus !== "kicked");
  const months = useMemo(() => buildMonths(almanac?.from ?? todayKey()), [almanac?.from]);
  const birthdayByDate = useMemo(() => {
    const map = new Map<string, BirthdayAlmanacPayload["birthdays"]>();
    for (const birthday of almanac?.birthdays ?? []) {
      map.set(birthday.date, [...(map.get(birthday.date) ?? []), birthday]);
    }
    return map;
  }, [almanac?.birthdays]);
  const warningsByDate = useMemo(() => new Map((almanac?.warnings ?? []).map((warning) => [warning.date, warning])), [almanac?.warnings]);
  const availableGenericCards = cards.filter((card) => card.state === "available" && card.scopeType !== "member").length;
  const customReadyCards = cards.filter((card) => card.state === "available" && card.scopeType === "member").length;

  function setPickedFile(file: File | null): void {
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setIssue("El fitxer no es imatge.");
      return;
    }

    setIssue(null);
    setUpload((current) => ({ ...current, file }));
  }

  async function handleUploadSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!upload.file) {
      setIssue("Falta imatge.");
      return;
    }

    try {
      await uploadBirthdayCard({
        scopeType: upload.scopeType,
        windowId: upload.scopeType === "window" ? Number(upload.windowId) : null,
        userId: upload.scopeType === "member" ? Number(upload.userId) : null,
        file: upload.file,
      });
      setUpload((current) => ({ ...current, file: null }));
      setSaveMessage("Imatge pujada.");
      setIssue(null);
      await refresh();
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "No s'ha pogut pujar.");
    }
  }

  async function handleCreateWindow(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      await createBirthdayWindow({
        label: draft.label,
        startsOn: draft.startsOn,
        endsOn: draft.endsOn,
        color: draft.color,
        enabled: true,
      });
      setDraft({ label: "", startsOn: todayKey(), endsOn: addDaysToDateKey(todayKey(), 6), color: randomBirthdayWindowColor() });
      setSaveMessage("Temporada creada.");
      setIssue(null);
      await refresh();
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "No s'ha pogut crear.");
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
      setSaveMessage("Kornibot copiat.");
    } catch {
      setIssue("Copia no disponible. Descarrega la imatge.");
    }
  }

  return (
    <RoutePage title="Almanac" summary="">
      <StatusNote issue={issue} />
      {saveMessage ? <div className="status-banner tone-good">{saveMessage}</div> : null}
      {almanac ? (
        <>
          <main
            className="almanac-page organic-fade-in"
            onPaste={(event) => {
              const file = firstImageFromTransfer(event.clipboardData?.items ?? null);
              if (file) {
                event.preventDefault();
                setPickedFile(file);
              }
            }}
          >
            <section className="almanac-mast">
              <div className="almanac-mast-head">
                <div>
                  <span className="label">12 mesos</span>
                  <h2>Felicitacions</h2>
                </div>
                <button className="almanac-manage-button" onClick={() => setIsManagerOpen(true)} type="button">
                  <SlidersHorizontal aria-hidden="true" size={17} />
                  Gestiona
                </button>
              </div>
              <div className="almanac-metrics">
                <span><b>{almanac.birthdays.length}</b> dates</span>
                <span><b>{availableGenericCards}</b> base</span>
                <span><b>{customReadyCards}</b> membre</span>
              </div>
            </section>

            {almanac.warnings.length > 0 ? (
              <section className="almanac-warning-strip">
                <AlertTriangle aria-hidden="true" size={18} />
                <div>
                  <strong>{almanac.warnings.length} risc</strong>
                  <span>{formatShortDate(almanac.warnings[0].date)}: {almanac.warnings[0].availableGenericCards}/{almanac.warnings[0].neededGenericCards}</span>
                </div>
              </section>
            ) : null}

            <section className="almanac-grid" aria-label="Almanac 12 mesos">
              {months.map((month) => (
                <MonthTile
                  key={monthKey(month)}
                  birthdayByDate={birthdayByDate}
                  month={month}
                  warningsByDate={warningsByDate}
                  windows={activeWindows}
                />
              ))}
            </section>
          </main>

          {isManagerOpen ? (
            <AlmanacManagerSheet
              activeTab={managerTab}
              cards={cards}
              cardsNextCursor={cardsNextCursor}
              copyKornibotImage={copyKornibotImage}
              draft={draft}
              handleCreateWindow={handleCreateWindow}
              handleUploadSubmit={handleUploadSubmit}
              isLoadingMoreCards={isLoadingMoreCards}
              loadMoreCards={loadMoreCards}
              memberOptions={memberOptions}
              onChange={refresh}
              onClose={() => setIsManagerOpen(false)}
              previewUrl={previewUrl}
              setActiveTab={setManagerTab}
              setDraft={setDraft}
              setPickedFile={setPickedFile}
              setUpload={setUpload}
              upload={upload}
              users={users}
              windowOptions={windowOptions}
              windows={windows}
            />
          ) : null}
        </>
      ) : (
        <section className="almanac-page">
          <EmptyState title="Carregant" description="Almanac en curs." />
        </section>
      )}
    </RoutePage>
  );
}

function AlmanacManagerSheet(props: {
  activeTab: ManagerTab;
  cards: BirthdayCard[];
  cardsNextCursor: number | null;
  copyKornibotImage: () => Promise<void>;
  draft: WindowDraft;
  handleCreateWindow: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleUploadSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  isLoadingMoreCards: boolean;
  loadMoreCards: () => Promise<void>;
  memberOptions: UserListPayload["items"];
  onChange: () => Promise<void>;
  onClose: () => void;
  previewUrl: string | null;
  setActiveTab: Dispatch<SetStateAction<ManagerTab>>;
  setDraft: Dispatch<SetStateAction<WindowDraft>>;
  setPickedFile: (file: File | null) => void;
  setUpload: Dispatch<SetStateAction<UploadState>>;
  upload: UploadState;
  users: UserListPayload["items"];
  windowOptions: BirthdayWindow[];
  windows: BirthdayWindow[];
}): ReactElement {
  return (
    <div className="almanac-sheet-backdrop" onClick={props.onClose} role="presentation">
      <section
        aria-label="Gestiona almanac"
        aria-modal="true"
        className="almanac-sheet"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        onPaste={(event) => {
          const file = firstImageFromTransfer(event.clipboardData?.items ?? null);
          if (file) {
            event.preventDefault();
            props.setPickedFile(file);
            props.setActiveTab("images");
          }
        }}
      >
        <div className="almanac-sheet-handle" aria-hidden="true" />
        <header className="almanac-sheet-head">
          <div>
            <h2>Gestiona</h2>
          </div>
          <button className="icon-button" aria-label="Tanca" onClick={props.onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <nav className="manager-tabs" aria-label="Seccions de gestió">
          <button className={props.activeTab === "images" ? "is-active" : ""} onClick={() => props.setActiveTab("images")} type="button">
            <Image aria-hidden="true" size={16} />
            Imatges
          </button>
          <button className={props.activeTab === "seasons" ? "is-active" : ""} onClick={() => props.setActiveTab("seasons")} type="button">
            <CalendarDays aria-hidden="true" size={16} />
            Temporades
          </button>
          <button className={props.activeTab === "kornibot" ? "is-active" : ""} onClick={() => props.setActiveTab("kornibot")} type="button">
            <Crown aria-hidden="true" size={16} />
            Kornibot
          </button>
        </nav>
        <div className="manager-content">
          {props.activeTab === "images" ? (
            <ImagesManager
              cards={props.cards}
              cardsNextCursor={props.cardsNextCursor}
              handleUploadSubmit={props.handleUploadSubmit}
              isLoadingMoreCards={props.isLoadingMoreCards}
              loadMoreCards={props.loadMoreCards}
              memberOptions={props.memberOptions}
              onChange={props.onChange}
              previewUrl={props.previewUrl}
              setPickedFile={props.setPickedFile}
              setUpload={props.setUpload}
              upload={props.upload}
              users={props.users}
              windowOptions={props.windowOptions}
              windows={props.windows}
            />
          ) : null}
          {props.activeTab === "seasons" ? (
            <SeasonsManager
              draft={props.draft}
              handleCreateWindow={props.handleCreateWindow}
              onChange={props.onChange}
              setDraft={props.setDraft}
              windows={props.windows}
            />
          ) : null}
          {props.activeTab === "kornibot" ? (
            <KornibotManager copyKornibotImage={props.copyKornibotImage} />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ImagesManager(props: {
  cards: BirthdayCard[];
  cardsNextCursor: number | null;
  handleUploadSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  isLoadingMoreCards: boolean;
  loadMoreCards: () => Promise<void>;
  memberOptions: UserListPayload["items"];
  onChange: () => Promise<void>;
  previewUrl: string | null;
  setPickedFile: (file: File | null) => void;
  setUpload: Dispatch<SetStateAction<UploadState>>;
  upload: UploadState;
  users: UserListPayload["items"];
  windowOptions: BirthdayWindow[];
  windows: BirthdayWindow[];
}): ReactElement {
  const availableCount = props.cards.filter((card) => card.state === "available").length;

  function setScopeType(scopeType: BirthdayCard["scopeType"]): void {
    props.setUpload((current) => ({
      ...current,
      scopeType,
      windowId: scopeType === "window" ? current.windowId : "",
      userId: scopeType === "member" ? current.userId : "",
    }));
  }

  return (
    <div className="manager-section">
      <form className="manager-upload-card" onSubmit={(event) => void props.handleUploadSubmit(event)}>
        <div className="manager-upload-top">
          <strong>Nova imatge</strong>
          <button className="primary-button" disabled={!props.upload.file} type="submit">
            <Upload aria-hidden="true" size={17} />
            Puja
          </button>
        </div>
        <div className="destination-chips" aria-label="Destí imatge">
          <button className={props.upload.scopeType === "global" ? "is-active" : ""} onClick={() => setScopeType("global")} type="button">
            <Globe2 aria-hidden="true" size={15} />
            Global
          </button>
          <button className={props.upload.scopeType === "window" ? "is-active" : ""} onClick={() => setScopeType("window")} type="button">
            <CalendarDays aria-hidden="true" size={15} />
            Temporada
          </button>
          <button className={props.upload.scopeType === "member" ? "is-active" : ""} onClick={() => setScopeType("member")} type="button">
            <UserRound aria-hidden="true" size={15} />
            Membre
          </button>
        </div>
        {props.upload.scopeType === "window" ? (
          <label className="manager-inline-select">
            <span>Temporada</span>
            <select value={props.upload.windowId} onChange={(event) => props.setUpload((current) => ({ ...current, windowId: event.target.value }))}>
              <option value="">Tria</option>
              {props.windowOptions.map((window) => <option key={window.id} value={window.id}>{window.label}</option>)}
            </select>
          </label>
        ) : null}
        {props.upload.scopeType === "member" ? (
          <label className="manager-inline-select">
            <span>Membre</span>
            <select value={props.upload.userId} onChange={(event) => props.setUpload((current) => ({ ...current, userId: event.target.value }))}>
              <option value="">Tria</option>
              {props.memberOptions.map((user) => <option key={user.userId} value={user.userId}>{memberName(user)}</option>)}
            </select>
          </label>
        ) : null}
        <label
          className={`manager-dropzone${props.previewUrl ? " has-preview" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            props.setPickedFile(event.dataTransfer.files[0] ?? null);
          }}
        >
          {props.previewUrl ? <img alt="" src={props.previewUrl} /> : <Upload aria-hidden="true" size={24} />}
          <span>{props.upload.file?.name ?? "Puja o enganxa"}</span>
          <input accept="image/*" type="file" onChange={(event) => props.setPickedFile(event.target.files?.[0] ?? null)} />
        </label>
      </form>

      <div className="repository-head">
        <div>
          <strong>Repositori</strong>
          <span>{availableCount} disponibles · {props.cards.length} total</span>
        </div>
      </div>
      <div className="card-tile-grid">
        {props.cards.length > 0 ? props.cards.map((card) => (
          <CardTile
            card={card}
            key={card.id}
            onChange={props.onChange}
            users={props.users}
            windows={props.windows}
          />
        )) : (
          <EmptyState title="Sense imatges" description="Puja globals, de temporada o de membre." />
        )}
      </div>
      {props.cardsNextCursor !== null ? (
        <button className="quiet-button" disabled={props.isLoadingMoreCards} onClick={() => void props.loadMoreCards()} type="button">
          <Plus aria-hidden="true" size={16} />
          {props.isLoadingMoreCards ? "Carregant" : "Mes"}
        </button>
      ) : null}
    </div>
  );
}

function SeasonsManager(props: {
  draft: WindowDraft;
  handleCreateWindow: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onChange: () => Promise<void>;
  setDraft: Dispatch<SetStateAction<WindowDraft>>;
  windows: BirthdayWindow[];
}): ReactElement {
  const [isCreating, setIsCreating] = useState(false);

  async function createWindow(event: FormEvent<HTMLFormElement>): Promise<void> {
    await props.handleCreateWindow(event);
    setIsCreating(false);
  }

  function setDraftDate(field: "start" | "end", value: string): void {
    props.setDraft((current) => ({
      ...current,
      ...birthdayPeriodFromDateFieldChange(current, field, value),
    }));
  }

  return (
    <div className="manager-section">
      <div className="season-title-row">
        <div>
          <strong>Temporades i dates assenyalades</strong>
          <span>{props.windows.filter((window) => window.enabled).length} actives · {props.windows.length} total</span>
        </div>
        <button className="quiet-button" onClick={() => setIsCreating((current) => !current)} type="button">
          <Plus aria-hidden="true" size={16} />
          Nova
        </button>
      </div>
      {isCreating ? (
        <form className="season-create-strip" onSubmit={(event) => void createWindow(event)}>
          <input aria-label="Nom" placeholder="Nom" value={props.draft.label} onChange={(event) => props.setDraft((current) => ({ ...current, label: event.target.value }))} />
          <div className="season-create-dates">
            <SeasonDatePicker label="Inici" value={props.draft.startsOn} onChange={(value) => setDraftDate("start", value)} />
            <SeasonDatePicker label="Final" value={props.draft.endsOn} onChange={(value) => setDraftDate("end", value)} />
          </div>
          <button className="primary-button" type="submit"><Save aria-hidden="true" size={16} />Desa</button>
        </form>
      ) : null}
      <div className="season-list">
        {props.windows.map((window) => (
          <SeasonRow key={window.id} onChange={props.onChange} window={window} />
        ))}
      </div>
    </div>
  );
}

function KornibotManager(props: {
  copyKornibotImage: () => Promise<void>;
}): ReactElement {
  return (
    <div className="kornibot-manager">
      <img alt="" src={buildApiAssetUrl(KORNIBOT_IMAGE_PATH)} />
      <div>
        <strong>Kornibot</strong>
        <span>Referència per generar targetes.</span>
      </div>
      <button className="quiet-button" onClick={() => void props.copyKornibotImage()} type="button">
        <Clipboard aria-hidden="true" size={17} />
        Copia
      </button>
      <a className="quiet-button" download href={buildApiAssetUrl(KORNIBOT_IMAGE_PATH)}>
        <Download aria-hidden="true" size={17} />
        Baixa
      </a>
    </div>
  );
}

function MonthTile(props: {
  month: Date;
  birthdayByDate: Map<string, BirthdayAlmanacPayload["birthdays"]>;
  warningsByDate: Map<string, BirthdayAlmanacPayload["warnings"][number]>;
  windows: BirthdayWindow[];
}): ReactElement {
  const year = props.month.getUTCFullYear();
  const month = props.month.getUTCMonth() + 1;
  const monthIndex = props.month.getUTCMonth();
  const days = daysInMonth(year, monthIndex);
  const leadingEmptyDays = mondayFirstMonthOffset(year, monthIndex);

  return (
    <article className="almanac-month">
      <header>
        <strong>{monthLabel(props.month)}</strong>
      </header>
      <div className="month-days">
        {Array.from({ length: leadingEmptyDays }, (_, index) => (
          <span aria-hidden="true" className="month-day is-empty" key={`empty-${index}`} />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          const key = dateKey(year, month, day);
          const birthdays = props.birthdayByDate.get(key) ?? [];
          const warning = props.warningsByDate.get(key) ?? null;
          const dayWindows = props.windows.filter((window) => key >= window.startsOn && key <= window.endsOn);
          return (
            <span
              className={`month-day${birthdays.length ? " has-birthday" : ""}${warning ? " has-warning" : ""}${dayWindows.length ? " has-window" : ""}`}
              key={key}
              style={dayWindows[0] ? { "--window-color": dayWindows[0].color } as CSSProperties : undefined}
              title={[...birthdays.map((birthday) => birthday.nickname ?? birthday.username ?? birthday.firstName ?? String(birthday.userId)), ...dayWindows.map((window) => window.label)].join(" · ")}
            >
              {birthdays.length > 0 ? <BirthdayCrownMarker count={birthdays.length} /> : day}
            </span>
          );
        })}
      </div>
    </article>
  );
}

function BirthdayCrownMarker(props: {
  count: number;
}): ReactElement {
  return (
    <svg aria-hidden="true" className="birthday-crown-marker" viewBox="0 0 24 24">
      <path d="M3.4 8.1 7.5 12l3.7-7.1c0.3-0.6 1.3-0.6 1.6 0l3.7 7.1 4.1-3.9c0.6-0.6 1.5 0 1.3 0.8l-1.8 9.1c-0.1 0.7-0.7 1.1-1.4 1.1H5.3c-0.7 0-1.3-0.5-1.4-1.1L2.1 8.9c-0.2-0.8 0.7-1.4 1.3-0.8Z" />
      {props.count > 1 ? (
        <text x="12" y="16.2">{props.count}</text>
      ) : null}
    </svg>
  );
}

function CardTile(props: {
  card: BirthdayCard;
  windows: BirthdayWindow[];
  users: UserListPayload["items"];
  onChange: () => Promise<void>;
}): ReactElement {
  const tileRef = useRef<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (isVisible) {
      return undefined;
    }

    const node = tileRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "160px" });

    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    void loadBirthdayCardImageObjectUrl(props.card.id).then((url) => {
      objectUrl = url;
      if (!cancelled) {
        setImageUrl(url);
      } else if (url) {
        URL.revokeObjectURL(url);
      }
    });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [isVisible, props.card.id]);

  async function setState(state: BirthdayCard["state"]): Promise<void> {
    await updateBirthdayCard(props.card.id, { state });
    await props.onChange();
  }

  return (
    <article className={`card-tile tone-${props.card.state}`} ref={tileRef}>
      <span className="card-tile-image">
        {imageUrl ? <img alt="" src={imageUrl} /> : <Image aria-hidden="true" size={18} />}
        <em>{stateLabel(props.card.state)}</em>
      </span>
      <div className="card-tile-copy">
        <strong>{scopeLabel(props.card, props.windows, props.users)}</strong>
        <span>{stateLabel(props.card.state)} · {formatBytes(props.card.sizeBytes)}</span>
      </div>
      <span className="card-tile-menu" aria-hidden="true"><MoreVertical size={15} /></span>
      <div className="card-tile-actions">
        {props.card.state !== "archived" ? (
          <button aria-label="Arxiva" className="icon-button" onClick={() => void setState("archived")} type="button">
            <Archive aria-hidden="true" size={16} />
          </button>
        ) : null}
        {props.card.state !== "disabled" ? (
          <button aria-label="Atura" className="icon-button" onClick={() => void setState("disabled")} type="button">
            <EyeOff aria-hidden="true" size={16} />
          </button>
        ) : null}
        {props.card.state !== "available" ? (
          <button aria-label="Activa" className="icon-button" onClick={() => void setState("available")} type="button">
            <Check aria-hidden="true" size={16} />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function SeasonDatePicker(props: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}): ReactElement {
  const [draft, setDraft] = useState(() => formatMonthDayInput(props.value));
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setDraft(formatMonthDayInput(props.value));
    setIsInvalid(false);
  }, [props.value]);

  function commit(): void {
    try {
      props.onChange(draft);
      setIsInvalid(false);
    } catch {
      setIsInvalid(true);
    }
  }

  return (
    <label className={`season-date-picker${isInvalid ? " is-invalid" : ""}`}>
      <span>{props.label}</span>
      <input
        aria-label={`${props.label} temporada`}
        aria-invalid={isInvalid}
        autoComplete="off"
        inputMode="numeric"
        pattern="[0-9]{1,2}[./-][0-9]{1,2}"
        placeholder="dd/mm"
        type="text"
        value={draft}
        onBlur={commit}
        onChange={(event) => {
          setDraft(event.target.value);
          if (isInvalid) {
            setIsInvalid(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <CalendarDays aria-hidden="true" size={21} />
    </label>
  );
}

function SeasonRow(props: {
  window: BirthdayWindow;
  onChange: () => Promise<void>;
}): ReactElement {
  const [label, setLabel] = useState(props.window.label);
  const [startsOn, setStartsOn] = useState(props.window.startsOn);
  const [endsOn, setEndsOn] = useState(props.window.endsOn);
  const [enabled, setEnabled] = useState(props.window.enabled);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  useEffect(() => {
    setLabel(props.window.label);
    setStartsOn(props.window.startsOn);
    setEndsOn(props.window.endsOn);
    setEnabled(props.window.enabled);
    setIsConfirmingDelete(false);
  }, [props.window]);

  async function save(): Promise<void> {
    await updateBirthdayWindow(props.window.id, { label, startsOn, endsOn, enabled });
    setIsEditing(false);
    await props.onChange();
  }

  async function toggleEnabled(nextEnabled: boolean): Promise<void> {
    setEnabled(nextEnabled);
    await updateBirthdayWindow(props.window.id, { enabled: nextEnabled });
    await props.onChange();
  }

  async function remove(): Promise<void> {
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }

    await deleteBirthdayWindow(props.window.id);
    await props.onChange();
  }

  function setDateField(field: "start" | "end", value: string): void {
    const range = birthdayPeriodFromDateFieldChange({ startsOn, endsOn }, field, value);
    setStartsOn(range.startsOn);
    setEndsOn(range.endsOn);
  }

  return (
    <article className={`season-row${enabled ? "" : " is-disabled"}`}>
      <div className="season-row-main">
        <i style={{ background: props.window.color }} />
        <div>
          <strong>{label}</strong>
          <span>{formatShortDate(startsOn)} - {formatShortDate(endsOn)}</span>
        </div>
        <label className="season-switch" aria-label={`${label} activa`}>
          <input checked={enabled} type="checkbox" onChange={(event) => void toggleEnabled(event.target.checked)} />
          <span />
        </label>
        <button aria-label="Edita" className="icon-button" onClick={() => setIsEditing((current) => !current)} type="button">
          <Pencil aria-hidden="true" size={15} />
        </button>
      </div>
      {isEditing ? (
        <div className="season-editor">
          <div className="season-editor-top">
            <label className="season-editor-field">
              <span>Nom de la temporada</span>
              <input aria-label="Nom temporada" value={label} onChange={(event) => setLabel(event.target.value)} />
            </label>
            <div className="season-auto-color" aria-label="Color automatic">
              <i style={{ background: props.window.color }} />
              <span>Color auto</span>
            </div>
          </div>
          <div className="season-interval">
            <span>Interval de dates</span>
            <div className="season-date-summary">
              <SeasonDatePicker label="Inici" value={startsOn} onChange={(value) => setDateField("start", value)} />
              <SeasonDatePicker label="Final" value={endsOn} onChange={(value) => setDateField("end", value)} />
            </div>
          </div>
          <div className="season-action-row">
            <button
              aria-label={isConfirmingDelete ? "Confirma eliminar temporada" : "Elimina temporada"}
              className={`season-delete-button${isConfirmingDelete ? " is-confirming" : ""}`}
              onClick={() => void remove()}
              type="button"
            >
              {isConfirmingDelete ? <Check aria-hidden="true" size={16} /> : <Trash2 aria-hidden="true" size={16} />}
              {isConfirmingDelete ? "Confirma" : "Elimina"}
            </button>
            <button aria-label="Desa temporada" className="primary-button" onClick={() => void save()} type="button">
              <Save aria-hidden="true" size={16} />
              Desa
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
