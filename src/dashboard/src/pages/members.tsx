import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  CalendarDays,
  ChevronRight,
  Crown,
  Heart,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import {
  loadApiAssetObjectUrl,
  loadSettings,
  loadUsers,
  refreshProfilePhotos,
  refreshCaaRoles,
  type CaaRoleRefreshPayload,
  type ProfilePhotoRefreshPayload,
  type QueryResult,
  type SettingsPayload,
  type UserListPayload,
} from "../lib/api";
import { EmptyState, RoutePage } from "../routes";
import {
  activityTone,
  foldSearchText,
  formatJoinedAt,
  formatRelativeActivity,
  initialsFor,
  memberStatusLabel,
  memberStatusTone,
} from "./members-utils";

type UserListItem = UserListPayload["items"][number];
type SortDirection = "desc" | "asc";
type PhotoRefreshState =
  | { status: "idle"; message: string | null }
  | { status: "running"; message: string }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

const DEFAULT_THRESHOLDS = {
  goodHours: 24,
  warmHours: 168,
};

function displayName(user: UserListItem): string {
  if (user.nickname) {
    return user.nickname;
  }

  if (user.username) {
    return `@${user.username.replace(/^@/, "")}`;
  }

  return `user ${user.userId}`;
}

function handleLabel(user: UserListItem): string {
  return user.username ? `@${user.username.replace(/^@/, "")}` : "sense usuari";
}

function handleSearchText(user: UserListItem): string {
  const username = user.username?.replace(/^@/, "") ?? "";
  return [
    handleLabel(user),
    username,
    username ? `@${username}` : "",
    `telegram ${user.telegramId}`,
    String(user.telegramId),
  ].join(" ");
}

const countFormatter = new Intl.NumberFormat("ca-ES");

function formatCount(value: number): string {
  return countFormatter.format(value);
}

function searchableText(user: UserListItem): string {
  return foldSearchText([
    displayName(user),
    handleSearchText(user),
    memberStatusLabel(user.lastMembershipStatus),
    user.dashboardRole ?? "",
    user.isDashboardSuperadmin ? "superadmin" : "",
    user.isCaaMember ? "caa" : "",
    user.isAuditGroupOwner ? "propietari" : "",
    user.isAuditGroupAdmin ? "admin administrador" : "",
  ].join(" "));
}

function lastSeenValue(user: UserListItem): number {
  return user.lastSeenAt ? Date.parse(user.lastSeenAt) : 0;
}

export function MembersPage(): ReactElement {
  const [usersResult, setUsersResult] = useState<QueryResult<UserListPayload> | null>(null);
  const [settingsResult, setSettingsResult] = useState<QueryResult<SettingsPayload> | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [forcePhotoRefresh, setForcePhotoRefresh] = useState(false);
  const [photoRefresh, setPhotoRefresh] = useState<PhotoRefreshState>({ status: "idle", message: null });
  const [caaRefresh, setCaaRefresh] = useState<PhotoRefreshState>({ status: "idle", message: null });
  const searchRef = useRef<HTMLInputElement>(null);

  async function refresh(): Promise<void> {
    try {
      const [users, settings] = await Promise.all([
        loadUsers(),
        loadSettings(),
      ]);
      setUsersResult(users);
      setSettingsResult(settings);
      setIssue(users.issue ?? settings.issue ?? null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "No s'han pogut carregar els membres.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus();
    }
  }, [searchOpen]);

  async function runPhotoRefresh(): Promise<void> {
    let cursor: number | null = null;
    let totals: Omit<ProfilePhotoRefreshPayload, "nextCursor" | "done"> = {
      checked: 0,
      updated: 0,
      empty: 0,
      skipped: 0,
      failed: 0,
      notDue: 0,
    };

    setPhotoRefresh({ status: "running", message: "0 revisats" });

    try {
      for (;;) {
        const result = await refreshProfilePhotos({
          cursor,
          force: forcePhotoRefresh,
        });
        totals = {
          checked: totals.checked + result.checked,
          updated: totals.updated + result.updated,
          empty: totals.empty + result.empty,
          skipped: totals.skipped + result.skipped,
          failed: totals.failed + result.failed,
          notDue: totals.notDue + result.notDue,
        };
        setPhotoRefresh({
          status: "running",
          message: `${totals.checked} revisats, ${totals.updated} fotos`,
        });

        if (result.done || result.nextCursor === null) {
          break;
        }

        cursor = result.nextCursor;
      }

      setPhotoRefresh({
        status: totals.failed > 0 ? "error" : "done",
        message: `${totals.checked} revisats, ${totals.updated} fotos, ${totals.empty} sense foto`,
      });
      await refresh();
    } catch (error) {
      setPhotoRefresh({
        status: "error",
        message: error instanceof Error ? error.message : "No s'han pogut actualitzar les fotos.",
      });
    }
  }

  async function runCaaRefresh(): Promise<void> {
    let cursor: number | null = null;
    let totals: Omit<CaaRoleRefreshPayload, "nextCursor" | "done"> = {
      checked: 0,
      active: 0,
      deactivated: 0,
      failed: 0,
    };

    setCaaRefresh({ status: "running", message: "0 revisats" });

    try {
      for (;;) {
        const result = await refreshCaaRoles({ cursor });
        totals = {
          checked: totals.checked + result.checked,
          active: totals.active + result.active,
          deactivated: totals.deactivated + result.deactivated,
          failed: totals.failed + result.failed,
        };
        setCaaRefresh({
          status: "running",
          message: `${totals.checked} revisats, ${totals.active} CAA`,
        });

        if (result.done || result.nextCursor === null) {
          break;
        }

        cursor = result.nextCursor;
      }

      setCaaRefresh({
        status: totals.failed > 0 ? "error" : "done",
        message: `${totals.checked} revisats, ${totals.active} CAA, ${totals.deactivated} baixes`,
      });
      await refresh();
    } catch (error) {
      setCaaRefresh({
        status: "error",
        message: error instanceof Error ? error.message : "No s'han pogut actualitzar els rols CAA.",
      });
    }
  }

  const users = usersResult?.data.items ?? [];
  const thresholds = settingsResult?.data.memberActivityThresholds ?? DEFAULT_THRESHOLDS;
  const foldedSearch = foldSearchText(searchText);
  const visibleUsers = useMemo(() => {
    const filtered = foldedSearch
      ? users.filter((user) => searchableText(user).includes(foldedSearch))
      : users;

    return [...filtered].sort((left, right) => {
      const diff = lastSeenValue(right) - lastSeenValue(left);
      return sortDirection === "desc" ? diff : -diff;
    });
  }, [foldedSearch, sortDirection, users]);

  const summary = usersResult?.data.summary;
  const knownUserCount = summary?.knownUserCount ?? users.length;
  const telegramCountLabel = summary?.telegramMemberCount !== null && summary?.telegramMemberCount !== undefined
    ? new Intl.NumberFormat("ca-ES").format(summary.telegramMemberCount)
    : null;
  const totalLabel = telegramCountLabel ?? new Intl.NumberFormat("ca-ES").format(knownUserCount);
  const unknownMemberCount = summary?.telegramMemberCount
    ? Math.max(0, summary.telegramMemberCount - knownUserCount)
    : 0;
  const messagesLast24hLabel = formatCount(summary?.messagesLast24h ?? 0);
  const reactionsGivenLast24hLabel = formatCount(summary?.reactionsGivenLast24h ?? 0);
  const now = new Date();
  const canRunMaintenance = settingsResult?.data.canManagePrivilegedSettings === true;
  const isInitialLoading = usersResult === null && issue === null;

  return (
    <RoutePage
      title="Membres"
      summary=""
    >
      {issue ? <div className="status-banner tone-warm">{issue}</div> : null}
      <section className="members-board" aria-label="Membres de Policornis">
        <header className="members-sticky-head">
          <div className="members-toolbar" aria-label="Controls de membres">
            <span className="members-chip">
              <UsersRound aria-hidden="true" size={18} />
              <strong>{totalLabel}</strong>
            </span>
            <span className="members-chip tone-good" title="Missatges ultimes 24 hores">
              <MessageCircle aria-hidden="true" size={18} />
              <strong>{messagesLast24hLabel}</strong>
            </span>
            <span className="members-chip tone-reaction" title="Reaccions donades ultimes 24 hores">
              <Heart aria-hidden="true" size={18} />
              <strong>{reactionsGivenLast24hLabel}</strong>
            </span>
            <button
              aria-label={sortDirection === "desc" ? "Ordena per menys recent" : "Ordena per més recent"}
              className="members-icon-button"
              onClick={() => setSortDirection((current) => current === "desc" ? "asc" : "desc")}
              type="button"
            >
              {sortDirection === "desc" ? (
                <ArrowDownNarrowWide aria-hidden="true" size={22} />
              ) : (
                <ArrowUpNarrowWide aria-hidden="true" size={22} />
              )}
            </button>
            <div className={`members-search${searchOpen || searchText ? " is-open" : ""}`}>
              <input
                aria-label="Cerca membres"
                onChange={(event) => setSearchText(event.target.value)}
                onBlur={() => {
                  if (!searchText) {
                    setSearchOpen(false);
                  }
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="cerca"
                ref={searchRef}
                value={searchText}
              />
              <button
                aria-label={searchOpen || searchText ? "Tanca cerca" : "Obre cerca"}
                className="members-search-toggle"
                onClick={(event) => {
                  if (searchOpen || searchText) {
                    setSearchText("");
                    setSearchOpen(false);
                    searchRef.current?.blur();
                    event.currentTarget.blur();
                    return;
                  }

                  setSearchOpen(true);
                  searchRef.current?.focus();
                }}
                type="button"
              >
                {searchOpen || searchText ? (
                  <X aria-hidden="true" size={17} />
                ) : (
                  <Search aria-hidden="true" size={22} />
                )}
              </button>
            </div>
          </div>
        </header>
        {isInitialLoading ? (
          <MembersSkeleton />
        ) : visibleUsers.length > 0 || (!foldedSearch && unknownMemberCount > 0) ? (
          <div className="members-list organic-fade-in">
            {visibleUsers.map((user) => (
              <MemberLine
                key={user.userId}
                now={now}
                thresholds={thresholds}
                user={user}
              />
            ))}
            {!foldedSearch && unknownMemberCount > 0 ? (
              <UnknownMembersLine count={unknownMemberCount} />
            ) : null}
          </div>
        ) : usersResult !== null || issue ? (
          <EmptyState
            title={users.length > 0 ? "Cap coincidencia" : "Sense membres observats"}
            description={users.length > 0 ? "Canvia la cerca." : "El directori es poblara amb usuaris vistos en updates del grup auditat."}
          />
        ) : null}
        {canRunMaintenance ? (
          <details className="members-maintenance">
            <summary>Manteniment</summary>
            <div className="members-maintenance-body">
              <div>
                <strong>Fotos de perfil</strong>
                {photoRefresh.message ? <span>{photoRefresh.message}</span> : null}
              </div>
              <label className="members-maintenance-toggle">
                <input
                  checked={forcePhotoRefresh}
                  disabled={photoRefresh.status === "running"}
                  onChange={(event) => setForcePhotoRefresh(event.target.checked)}
                  type="checkbox"
                />
                Força totes
              </label>
              <button
                className="quiet-button"
                disabled={photoRefresh.status === "running"}
                onClick={() => void runPhotoRefresh()}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={16} />
                Actualitza
              </button>
              <div>
                <strong>Rols CAA</strong>
                {caaRefresh.message ? <span>{caaRefresh.message}</span> : null}
              </div>
              <button
                className="quiet-button"
                disabled={caaRefresh.status === "running"}
                onClick={() => void runCaaRefresh()}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={16} />
                Actualitza CAA
              </button>
            </div>
          </details>
        ) : null}
      </section>
    </RoutePage>
  );
}

function UnknownMembersLine(props: { count: number }): ReactElement {
  const markerCount = Math.min(props.count, 12);

  return (
    <div className="member-line member-line-unknown" aria-label={`${props.count} membres pendents d'observar`}>
      <span className="unknown-member-markers" aria-hidden="true">
        {Array.from({ length: markerCount }, (_, index) => (
          <span key={index}>?</span>
        ))}
      </span>
      <span className="member-main">
        <strong>{new Intl.NumberFormat("ca-ES").format(props.count)} membres desconeguts</strong>
        <span className="member-handle">Encara sense perfil observat</span>
      </span>
    </div>
  );
}

function MembersSkeleton(): ReactElement {
  return (
    <div className="members-list members-skeleton" aria-label="Carregant membres" aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="member-line member-line-skeleton" key={index}>
          <span className="member-avatar skeleton-block" />
          <span className="member-main">
            <span className="skeleton-line skeleton-line-strong" />
            <span className="skeleton-line skeleton-line-medium" />
            <span className="member-statuses">
              <span className="skeleton-pill" />
              <span className="skeleton-pill skeleton-pill-short" />
            </span>
            <span className="skeleton-line skeleton-line-short" />
          </span>
          <span className="member-metrics member-metrics-skeleton">
            <span className="skeleton-pill" />
            <span className="member-activity-counts">
              <span className="skeleton-pill skeleton-pill-short" />
              <span className="skeleton-pill skeleton-pill-short" />
            </span>
          </span>
          <span className="member-chevron skeleton-chevron" />
        </div>
      ))}
    </div>
  );
}

function MemberLine(props: {
  now: Date;
  thresholds: SettingsPayload["memberActivityThresholds"];
  user: UserListItem;
}): ReactElement {
  const name = displayName(props.user);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const statusTone = memberStatusTone(props.user.lastMembershipStatus);
  const recencyTone = activityTone(props.user.lastSeenAt, props.thresholds, props.now);
  const isSuperadmin = props.user.isDashboardSuperadmin;
  const isCaaMember = props.user.isCaaMember;
  const isOwner = props.user.isAuditGroupOwner;
  const isAdmin = props.user.isAuditGroupAdmin;
  const hasUsername = Boolean(props.user.username);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadPhoto(): Promise<void> {
      if (!props.user.profilePhoto?.url) {
        setPhotoUrl(null);
        return;
      }

      objectUrl = await loadApiAssetObjectUrl(props.user.profilePhoto.url).catch(() => null);
      if (!cancelled) {
        setPhotoUrl(objectUrl);
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
  }, [props.user.profilePhoto?.url]);

  return (
    <Link className="member-line" to={`/users/${props.user.userId}`}>
      <span className="member-avatar" aria-hidden="true">
        {photoUrl ? <img alt="" onError={() => setPhotoUrl(null)} src={photoUrl} /> : <span>{initialsFor(name)}</span>}
      </span>
      <span className="member-main">
        <strong className="member-name">{name}</strong>
        <span className={`member-handle${hasUsername ? "" : " is-missing"}`}>{handleLabel(props.user)}</span>
        <span className="member-statuses">
          <span className={`member-status tone-${statusTone}`}>
            <i aria-hidden="true" />
            {memberStatusLabel(props.user.lastMembershipStatus)}
          </span>
          {isSuperadmin ? (
            <span aria-label="Superadmin" className="member-role member-role-superadmin" title="Superadmin">
              <ShieldCheck aria-hidden="true" size={13} strokeWidth={2.4} />
            </span>
          ) : null}
          {isCaaMember ? <span className="member-role member-role-caa">CAA</span> : null}
          {isOwner ? (
            <span aria-label="Propietari" className="member-role member-role-owner" title="Propietari">
              <Crown aria-hidden="true" size={13} strokeWidth={2.4} />
            </span>
          ) : null}
          {isAdmin ? <span className="member-role member-role-admin">Admin</span> : null}
        </span>
        <span className="member-joined">
          <CalendarDays aria-hidden="true" size={15} />
          {formatJoinedAt(props.user.lastJoinedAt)}
        </span>
      </span>
      <span className="member-metrics">
        <span className={`activity-pill tone-${recencyTone}`}>{formatRelativeActivity(props.user.lastSeenAt, props.now)}</span>
        <span className="member-activity-counts" aria-label="Activitat ultimes 24 hores">
          <span className="member-activity-count" title="Missatges ultimes 24 hores">
            <MessageCircle aria-hidden="true" size={15} />
            {formatCount(props.user.messagesLast24h)}
          </span>
          <span className="member-activity-count tone-reaction" title="Reaccions donades ultimes 24 hores">
            <Heart aria-hidden="true" size={15} />
            {formatCount(props.user.reactionsGivenLast24h)}
          </span>
        </span>
      </span>
      <ChevronRight className="member-chevron" aria-hidden="true" size={22} />
    </Link>
  );
}
