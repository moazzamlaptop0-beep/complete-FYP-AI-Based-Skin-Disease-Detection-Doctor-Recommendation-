/**
 * ViewAsPicker — admin impersonation, deliberately made to feel heavy.
 *
 * THE REQUIREMENT
 * ---------------
 * "Admin can perform all actions of doctor and user." Half of that is
 * capability (`ADMIN_PERMS ⊃ DOCTOR_PERMS ⊃ PATIENT_PERMS` in rbac.py); the
 * other half is *identity*: an admin fixing a doctor's schedule must act as
 * that doctor, so the row that changes is theirs and the audit row is the
 * admin's. That is what `X-Act-As-User-Id` does, and this picker is its only
 * entry point.
 *
 * WHY IT LOOKS NOTHING LIKE WorkspaceSwitcher
 * -------------------------------------------
 * WorkspaceSwitcher is a user opening their OWN lower-privilege surface — a
 * doctor looking at their own scans. Nobody else's data is involved and nothing
 * is logged. Impersonation is the opposite: you are inside someone else's
 * account, writing to their records, with your name on every row. The two must
 * never be mistaken for each other, so this one is danger-toned throughout,
 * carries a shield, states the consequences in the confirm step, and hands off
 * to the undismissable red ViewAsBanner. The switcher is a quiet neutral menu.
 *
 * READ-WRITE, ON PURPOSE
 * ----------------------
 * This is not a preview mode. Once engaged, every request the app makes carries
 * the header and the backend genuinely performs the action as the target, while
 * writing `audit_logs` against the ADMIN's account. The admin console itself
 * goes dark while it is on (effective permissions are an intersection, so
 * `/admin/*` 403s) — which is why confirming navigates straight to the target's
 * own surface instead of leaving you on a page that is about to fail.
 */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Lock,
  Search,
  ShieldAlert,
  Stethoscope,
  User,
  UserCheck,
} from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Pagination,
  RoleBadge,
  SearchInput,
  Skeleton,
  Tooltip,
  cn,
  notify,
} from '../../../components/ui';
import { useAuth } from '../../../context/AuthContext';
import useExitActingAs from '../../../components/layout/useExitActingAs';
import { admin as adminEndpoints } from '../../../lib/endpoints';
import { ROLES, roleRank } from '../../../lib/permissions';
import { PATHS } from '../../../routes';
import { usePaginatedQuery } from '../hooks/usePaginatedQuery';

/** Where a target's own workspace starts. */
const HOME_FOR_ROLE = {
  [ROLES.DOCTOR]: PATHS.DOCTOR_REFERRALS,
  [ROLES.PATIENT]: PATHS.PATIENT_SCANS,
};

const SCOPES = [
  { id: 'all', label: 'Everyone', role: '', icon: UserCheck },
  { id: 'doctor', label: 'Doctors', role: ROLES.DOCTOR, icon: Stethoscope },
  { id: 'patient', label: 'Patients', role: ROLES.PATIENT, icon: User },
];

/**
 * Why this row cannot be impersonated, or null when it can.
 * Mirrors `rbac.py` exactly, so the UI never offers an action the server
 * refuses — a disabled control with a reason beats a red toast.
 */
export function blockedReason(row, actorRole) {
  if (!row) return 'Unknown account.';
  if (row.is_root) return 'Root accounts are protected and can never be impersonated.';
  if (roleRank(actorRole) <= roleRank(row.role)) {
    return 'You can only act as an account with a lower role than your own.';
  }
  if (row.is_active === false) return 'This account is suspended. Reactivate it first.';
  return null;
}

function TargetRow({ row, actorRole, onPick }) {
  const reason = blockedReason(row, actorRole);
  const disabled = Boolean(reason);

  const button = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(row)}
      aria-label={`Act as ${row.name || row.email}`}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border border-subtle bg-surface p-3 text-left transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'hover:border-danger-400 hover:bg-danger-50',
      )}
    >
      <Avatar name={row.name || row.email} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium text-default">
            {row.name || 'Unnamed account'}
          </span>
          <RoleBadge role={row.role} size="sm" />
          {row.is_root ? (
            <Badge tone="warning" size="sm" icon={<Lock className="h-3 w-3" aria-hidden="true" />}>
              Protected
            </Badge>
          ) : null}
          {row.is_active === false ? (
            <Badge tone="danger" size="sm">Suspended</Badge>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-caption text-muted">{row.email}</span>
      </span>
      {!disabled ? (
        <ShieldAlert className="h-4 w-4 shrink-0 text-danger-500" aria-hidden="true" />
      ) : (
        <Lock className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      )}
    </button>
  );

  // A disabled <button> swallows pointer events in most browsers, so the
  // tooltip has to hang off a wrapper or the reason would be unreadable —
  // which would leave a locked row with no explanation at all.
  return (
    <li>
      {disabled
        ? <Tooltip content={reason}><span className="block">{button}</span></Tooltip>
        : button}
    </li>
  );
}

/**
 * The drawer body: search → pick → confirm.
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export function ViewAsDrawer({ open, onClose }) {
  const { user, setActingAs } = useAuth();
  const navigate = useNavigate();

  const [scope, setScope] = useState('all');
  const [term, setTerm] = useState('');
  const [candidate, setCandidate] = useState(null);
  const [busy, setBusy] = useState(false);

  const filters = useMemo(
    () => ({ q: term, role: SCOPES.find((s) => s.id === scope)?.role || '' }),
    [scope, term],
  );

  const query = usePaginatedQuery({
    path: adminEndpoints.users,
    filters,
    perPage: 10,
    enabled: open,
  });

  const close = () => {
    setCandidate(null);
    onClose();
  };

  const engage = async () => {
    if (!candidate) return;
    setBusy(true);
    try {
      await setActingAs({
        id: candidate.id,
        name: candidate.name || candidate.email,
        role: candidate.role,
        is_root: candidate.is_root,
      });
      notify.warning(`You are now acting as ${candidate.name || candidate.email}. Every action is recorded.`);
      close();
      navigate(HOME_FOR_ROLE[candidate.role] || PATHS.PATIENT_SCANS);
    } catch (error) {
      notify.error(error?.message || 'Could not start acting as this user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={close}
      side="right"
      size="md"
      title={candidate ? 'Confirm impersonation' : 'Act as another user'}
      description={
        candidate
          ? undefined
          : 'You will genuinely perform actions as them. Every request is written to the audit log against your own account.'
      }
    >
      {candidate ? (
        <div className="flex flex-col gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setCandidate(null)}
            leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
          >
            Pick someone else
          </Button>

          <div className="flex items-center gap-3 rounded-lg border border-danger-300 bg-danger-50 p-3">
            <Avatar name={candidate.name || candidate.email} size="md" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-neutral-900">
                {candidate.name || candidate.email}
              </p>
              <p className="truncate text-caption text-muted">{candidate.email}</p>
            </div>
            <RoleBadge role={candidate.role} className="ml-auto" />
          </div>

          <Alert tone="danger" title="This is not a preview" icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}>
            <ul className="list-disc space-y-1 pl-4">
              <li>Anything you do is really done, to their records.</li>
              <li>Every request is logged as <strong>you</strong>, acting as them.</li>
              <li>The admin console is unavailable until you exit; you will be taken to their workspace.</li>
              <li>A red banner stays on screen the whole time, with an Exit button.</li>
            </ul>
          </Alert>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setCandidate(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={engage}
              loading={busy}
              leftIcon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
            >
              Act as {candidate.name?.split(' ')[0] || 'this user'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* role="group" + aria-pressed, NOT role="tablist": these switch a
              query, not a panel, and there is no tabpanel for them to own. */}
          <div role="group" aria-label="Filter by role" className="flex flex-wrap gap-2">
            {SCOPES.map((option) => {
              const Icon = option.icon;
              const active = scope === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setScope(option.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-body-sm transition',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                    active
                      ? 'border-danger-400 bg-danger-50 font-medium text-danger-700'
                      : 'border-subtle bg-surface text-muted hover:border-strong',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>

          <SearchInput
            placeholder="Search by name or email"
            onDebouncedChange={setTerm}
            loading={query.loading || query.refreshing}
            aria-label="Search accounts to act as"
          />

          {query.error ? (
            <Alert tone="danger" title="Could not load accounts">
              {query.error.message}
            </Alert>
          ) : query.loading ? (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading accounts">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} shape="rect" height={64} />
              ))}
            </div>
          ) : query.items.length === 0 ? (
            <EmptyState
              icon={<Search className="h-6 w-6" aria-hidden="true" />}
              title="No accounts match"
              description="Try a different name, email or role."
              size="sm"
            />
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {query.items.map((row) => (
                  <TargetRow key={row.id} row={row} actorRole={user?.role} onPick={setCandidate} />
                ))}
              </ul>
              {query.total > query.perPage ? (
                <Pagination
                  page={query.page}
                  pageSize={query.perPage}
                  total={query.total}
                  onPageChange={query.setPage}
                  compact
                />
              ) : null}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

/**
 * The confirm step on its own, so a row's "Act as…" can live in an overflow menu
 * as well as on a button.
 *
 * It is exported because the alternative — a second copy of the confirm copy and
 * the `setActingAs` + navigate sequence inside PatientsPage — is how one of the
 * two ends up missing the `notify.warning` that tells the admin their identity
 * just changed.
 *
 * @param {object} props
 * @param {{id:number,name?:string,email?:string,role?:string,is_root?:boolean,is_active?:boolean}|null} props.target
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export function ActAsConfirmDialog({ target, open, onClose }) {
  const { setActingAs } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const name = target?.name || target?.email || `User #${target?.id}`;

  const engage = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await setActingAs({
        id: target.id,
        name,
        role: target.role,
        is_root: target.is_root,
      });
      notify.warning(`You are now acting as ${name}. Every action is recorded.`);
      onClose();
      navigate(HOME_FOR_ROLE[target.role] || PATHS.PATIENT_SCANS);
    } catch (error) {
      notify.error(error?.message || 'Could not start acting as this user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={open && Boolean(target)}
      onClose={onClose}
      onConfirm={engage}
      loading={busy}
      closeOnConfirm={false}
      tone="danger"
      title={`Act as ${name}?`}
      confirmLabel="Yes, act as them"
      cancelLabel="Stay as myself"
      description="You will be signed into their workspace and everything you do there is really done, to their records, under your name in the audit log. The admin console pauses until you exit."
    />
  );
}

/**
 * Row-level "act as this person" for the doctor and patient tables.
 *
 * Same guarantees as the drawer: blocked targets render disabled with the
 * server's own reason in a tooltip, and engaging always confirms first, because
 * a single click that silently rewrites your identity is how an admin edits the
 * wrong record.
 *
 * @param {object} props
 * @param {{id:number,name?:string,email?:string,role?:string,is_root?:boolean,is_active?:boolean}} props.target
 */
export function ActAsButton({ target, size = 'sm', variant = 'ghost', label = 'Act as' }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const reason = blockedReason(target, user?.role);

  const button = (
    <Button
      size={size}
      variant={variant}
      disabled={Boolean(reason)}
      onClick={() => setOpen(true)}
      leftIcon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
    >
      {label}
    </Button>
  );

  return (
    <>
      {reason ? <Tooltip content={reason}><span className="inline-flex">{button}</span></Tooltip> : button}
      <ActAsConfirmDialog target={target} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The launcher. Renders the current impersonation state when one is live, so
 * an admin who lands back on the console knows why everything is 403-ing.
 */
export function ViewAsPicker({ className, buttonVariant = 'outline', size = 'md' }) {
  const { actingAs } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  // Clears the delegation AND moves off the impersonated page. Straight
  // `exitActingAs` would leave an admin standing on a doctor route as themselves,
  // where the sidebar is now empty and the data is stale.
  const exitActingAs = useExitActingAs();

  if (actingAs) {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        <Badge tone="danger" variant="solid" icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}>
          Acting as {actingAs.name}
        </Badge>
        <Button
          size={size}
          variant="outline"
          onClick={() => navigate(HOME_FOR_ROLE[actingAs.role] || PATHS.PATIENT_SCANS)}
        >
          Open their workspace
        </Button>
        <Button size={size} variant="danger" onClick={exitActingAs}>
          Stop acting as
        </Button>
      </div>
    );
  }

  return (
    <div className={className}>
      <Button
        variant={buttonVariant}
        size={size}
        onClick={() => setOpen(true)}
        leftIcon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
        className="border-danger-300 text-danger-700 hover:bg-danger-50"
      >
        Act as a user
      </Button>
      <ViewAsDrawer open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export default ViewAsPicker;
