/**
 * AdminPatientsPage — the account roster, and every write an admin has on it.
 *
 * WHAT AN ADMIN CAN DO HERE
 * -------------------------
 * Add an account, edit one, reset a password, suspend or reactivate, delete a
 * duplicate, book an appointment for someone, or act as them. That is deliberately
 * the whole set: before this, the console could only READ this table and flip
 * `is_active`, so "a patient phoned, they mistyped their email at signup" ended at
 * a psql prompt.
 *
 * Each of those has a different weight, and the row reflects it. Suspend is the
 * labelled button because it is the one an admin reaches for on a live account;
 * everything else is in the overflow menu, ordered from harmless (Edit) to
 * irreversible (Delete). See RowActions for why it is a menu and not eight
 * buttons.
 *
 * TWO SCOPES, ONE HOOK
 * --------------------
 * `/admin/patients` is the 7-key patient view (with scan and appointment
 * counts) and is what this page opens on. `/admin/users` is the 10-key view
 * over EVERY role, and it is the only one that carries `role` and — crucially —
 * `is_root`. Both are the same page envelope, so `usePaginatedQuery` serves
 * both; `queryKey` is what makes swapping between them refetch even when the
 * search box has not changed.
 *
 * SUSPEND, NEVER DELETE
 * ---------------------
 * `PATCH /admin/users/<id>/status` is the soft control: the row survives, their
 * scans and appointments survive, they simply cannot log in. It is the right
 * answer for a real person, and the reason is recorded in `audit_logs` against
 * the admin who typed it. Hard deletion of a user only exists for fake doctor
 * signups and lives on the Doctors page.
 *
 * `is_root` IS NOT A HINT
 * -----------------------
 * The backend returns 403 `Access denied! Root accounts are protected.` and
 * leaves the row completely untouched — no flag change, no token bump, no audit
 * row. A UI that offered the button anyway would be promising something it
 * cannot deliver, so root rows render with a lock, a PROTECTED badge, a tinted
 * row and DISABLED controls whose tooltip says exactly why. The same is true of
 * your own account (400: you cannot deactivate yourself).
 */

import React, { useMemo, useState } from 'react';
import {
  CalendarPlus,
  KeyRound,
  Lock,
  Pencil,
  Search,
  ShieldAlert,
  ShieldOff,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  ModalFooter,
  RoleBadge,
  SearchInput,
  Select,
  Textarea,
  Tooltip,
  cn,
  notify,
} from '../../components/ui';
import { patch } from '../../lib/api';
import { admin as adminEndpoints } from '../../lib/endpoints';
import { formatDate, formatNumber } from '../../lib/format';
import { ROLES } from '../../lib/permissions';
import { useAuth } from '../../context/AuthContext';
import { AdminPage, AdminTable, FilterBar, SegmentedFilter, StackCell } from './components/AdminPage';
import AccountFormModal from './components/AccountFormModal';
import { DeleteAccountDialog, ResetPasswordDialog } from './components/AccountDangerDialogs';
import { accountActionLock } from './components/accountLocks';
import BookAppointmentDrawer from './components/BookAppointmentDrawer';
import { ImpersonationNotice } from './components/ImpersonationNotice';
import RowActions from './components/RowActions';
import { ActAsConfirmDialog, ViewAsPicker, blockedReason } from './components/ViewAsPicker';
import { usePaginatedQuery } from './hooks/usePaginatedQuery';

const SCOPES = [
  { value: 'patients', label: 'Patients' },
  { value: 'users', label: 'All accounts' },
];

const ACTIVE_OPTIONS = [
  { value: '', label: 'Active and suspended' },
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Suspended only' },
];

const ROLE_OPTIONS = [
  { value: '', label: 'Every role' },
  { value: ROLES.PATIENT, label: 'Patients' },
  { value: ROLES.DOCTOR, label: 'Doctors' },
  { value: ROLES.ADMIN, label: 'Admins' },
];

/**
 * Why this account's status cannot be changed, or null when it can.
 * Mirrors the refusal order in the contract exactly.
 * @param {object} row
 * @param {number} selfId
 */
export function statusLockReason(row, selfId) {
  if (row?.is_root) return 'Root accounts are protected. The server refuses to change them at all.';
  if (row?.id === selfId) return 'You cannot deactivate your own account.';
  return null;
}

/** The suspend / reactivate sheet. Reason is optional to the API, insisted on here. */
function StatusModal({ row, open, onClose, onChanged }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    setReason('');
    setError(null);
  }, [row?.id, open]);

  if (!row) return null;

  const suspending = row.is_active !== false;

  const submit = async () => {
    if (suspending && !reason.trim()) {
      setError('Say why. This is written to the audit log and is the only record of the decision.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await patch(adminEndpoints.updateUserStatus(row.id), {
        is_active: !suspending,
        reason: reason.trim(),
      });
      notify.success(suspending
        ? `${row.name || 'Account'} suspended.`
        : `${row.name || 'Account'} reactivated.`);
      onChanged(row.id, {
        is_active: typeof result?.is_active === 'boolean' ? result.is_active : !suspending,
      });
      onClose();
    } catch (err) {
      setError(err?.message || 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={suspending ? `Suspend ${row.name || 'this account'}?` : `Reactivate ${row.name || 'this account'}?`}
      description={row.email}
      footer={
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={suspending ? 'danger' : 'success'}
            onClick={submit}
            loading={busy}
            leftIcon={suspending
              ? <ShieldOff className="h-4 w-4" aria-hidden="true" />
              : <UserCheck className="h-4 w-4" aria-hidden="true" />}
          >
            {suspending ? 'Suspend account' : 'Reactivate account'}
          </Button>
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert tone={suspending ? 'warning' : 'info'} title={suspending ? 'Nothing is deleted' : 'They can log in again'}>
          {suspending
            ? 'They will not be able to log in. Their scans, appointments and reports stay exactly where they are, so a doctor’s existing notes are not rewritten by an account action.'
            : 'Access is restored immediately. Their history was never touched.'}
        </Alert>

        <Field
          label="Reason"
          hint="Recorded in the audit log against your account, alongside the old and new value."
          error={error || undefined}
          required={suspending}
        >
          <Textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={suspending
              ? 'e.g. Duplicate account created during testing.'
              : 'e.g. Verified with the patient by phone; suspension lifted.'}
          />
        </Field>
      </div>
    </Modal>
  );
}

export default function AdminPatientsPage() {
  const { user, actingAs } = useAuth();
  const [scope, setScope] = useState('patients');
  const [term, setTerm] = useState('');
  const [isActive, setIsActive] = useState('');
  const [role, setRole] = useState('');

  // One piece of state per sheet rather than a single `{type, row}`: they are
  // opened from different places (a row menu, the page header) and a shared slot
  // makes "close the delete dialog, open the edit one" a source of flicker.
  const [editing, setEditing] = useState(null);      // suspend / reactivate
  const [form, setForm] = useState(null);            // {mode, row}
  const [resetting, setResetting] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [booking, setBooking] = useState(null);      // {patient}
  const [actingTarget, setActingTarget] = useState(null);

  const usersScope = scope === 'users';

  const filters = useMemo(
    () => (usersScope
      ? { q: term, is_active: isActive, role }
      : { q: term, is_active: isActive }),
    [usersScope, term, isActive, role],
  );

  const query = usePaginatedQuery({
    path: usersScope ? adminEndpoints.users : adminEndpoints.patients,
    queryKey: scope,
    filters,
    enabled: !actingAs,
  });

  const rootCount = query.items.filter((row) => row.is_root).length;

  /**
   * The overflow menu for one row, harmless first and irreversible last.
   *
   * Every `disabledReason` here comes from the same rule the SERVER enforces, so
   * a greyed item is never a guess: `blockedReason` mirrors rbac.py's act-as
   * checks, `statusLockReason` mirrors the status endpoint's refusal order, and
   * `accountActionLock` mirrors `_manage_guard`. An item that would 403 arrives
   * disabled with the reason attached instead of failing after the click.
   */
  const rowActions = (row) => {
    const target = { ...row, role: row.role || ROLES.PATIENT };
    const suspending = row.is_active !== false;
    const statusReason = statusLockReason(row, user?.id);
    // `/admin/patients` omits `role` entirely — every row there is a patient.
    const isPatient = (row.role || ROLES.PATIENT) === ROLES.PATIENT;

    return [
      {
        id: 'reset',
        label: 'Reset password…',
        icon: KeyRound,
        disabledReason: accountActionLock(row, user, 'reset'),
        onSelect: () => setResetting(row),
      },
      isPatient && {
        id: 'book',
        label: 'Book an appointment…',
        icon: CalendarPlus,
        disabledReason: row.is_active === false
          ? 'Reactivate the account first — a suspended patient cannot be booked.'
          : null,
        onSelect: () => setBooking({ patient: row }),
      },
      {
        id: 'act-as',
        label: 'Act as this person…',
        icon: ShieldAlert,
        disabledReason: blockedReason(target, user?.role),
        onSelect: () => setActingTarget(target),
        separatorBefore: true,
      },
      {
        id: 'status',
        label: suspending ? 'Suspend account…' : 'Reactivate account…',
        icon: suspending ? ShieldOff : UserCheck,
        disabledReason: statusReason,
        danger: suspending,
        onSelect: () => setEditing(row),
        separatorBefore: true,
      },
      {
        id: 'delete',
        label: 'Delete account…',
        icon: Trash2,
        disabledReason: accountActionLock(row, user, 'delete'),
        danger: true,
        onSelect: () => setDeleting(row),
      },
    ];
  };

  const columns = [
    {
      key: 'name',
      header: 'Account',
      render: (row) => {
        const locked = Boolean(row.is_root);
        return (
          <div className="flex items-center gap-3">
            <Avatar name={row.name || row.email} size="sm" ring={locked} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                  {row.name || 'Unnamed account'}
                </span>
                {locked ? (
                  <Badge tone="warning" size="sm" icon={<Lock className="h-3 w-3" aria-hidden="true" />}>
                    Protected
                  </Badge>
                ) : null}
                {row.id === user?.id ? <Badge tone="primary" size="sm">You</Badge> : null}
              </div>
              <span className="block truncate text-caption text-muted">{row.email}</span>
            </div>
          </div>
        );
      },
    },
    ...(usersScope ? [{
      key: 'role',
      header: 'Role',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <RoleBadge role={row.role} />
          {row.role === ROLES.DOCTOR && row.verification_status ? (
            <span className="text-caption text-muted">{row.verification_status}</span>
          ) : null}
        </div>
      ),
    }] : []),
    ...(usersScope ? [] : [{
      key: 'scan_count',
      header: 'Activity',
      hideOnMobile: true,
      render: (row) => (
        <StackCell
          primary={`${formatNumber(row.scan_count ?? 0)} scan${row.scan_count === 1 ? '' : 's'}`}
          secondary={`${formatNumber(row.appointment_count ?? 0)} appointment${row.appointment_count === 1 ? '' : 's'}`}
        />
      ),
    }]),
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => (
        row.is_active === false
          ? <Badge tone="danger" dot>Suspended</Badge>
          : <Badge tone="success" dot>Active</Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Joined',
      hideOnMobile: true,
      render: (row) => <span className="whitespace-nowrap text-body-sm">{formatDate(row.created_at)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setForm({ mode: 'edit', row })}
            leftIcon={<Pencil className="h-4 w-4" aria-hidden="true" />}
          >
            Edit
          </Button>
          <RowActions
            label={`Actions for ${row.name || row.email}`}
            actions={rowActions(row)}
          />
        </div>
      ),
    },
  ];

  // SearchInput is uncontrolled (it owns the debounce), so clearing filters has
  // to remount it or the box keeps showing a term that is no longer applied.
  const [resetKey, setResetKey] = useState(0);
  const resetFilters = () => {
    setTerm('');
    setIsActive('');
    setRole('');
    setResetKey((n) => n + 1);
  };

  const filtersDirty = Boolean(term || isActive || role);

  return (
    <AdminPage
      title="Patients & accounts"
      description="Add or edit an account, reset a password, or book for someone who phoned in. Suspending stops a person signing in without touching a single scan, appointment or doctor’s note — erasing a person erases their clinical record too, which is why deletion refuses an account with history."
      actions={(
        <>
          <Button
            variant="primary"
            onClick={() => setForm({ mode: 'create', row: null })}
            leftIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
            disabled={Boolean(actingAs)}
          >
            Add account
          </Button>
          <Button
            variant="outline"
            onClick={() => setBooking({ patient: null })}
            leftIcon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}
            disabled={Boolean(actingAs)}
          >
            Book appointment
          </Button>
          <ViewAsPicker />
        </>
      )}
      banner={<ImpersonationNotice />}
      paused={Boolean(actingAs)}
    >
      {rootCount > 0 ? (
        <Alert tone="neutral" title="Some accounts on this page are protected" icon={<Lock className="h-5 w-5" aria-hidden="true" />}>
          Root accounts cannot be suspended, deleted or impersonated — the server refuses and leaves
          the row untouched. Their controls are disabled here rather than failing after you click.
        </Alert>
      ) : null}

      <FilterBar onRefresh={query.refetch} busy={query.refreshing} onReset={filtersDirty ? resetFilters : undefined}>
        <SegmentedFilter
          label="Which accounts"
          options={SCOPES}
          value={scope}
          onChange={setScope}
        />
        <div className="w-full sm:w-64">
          <SearchInput
            key={`accounts-${resetKey}`}
            placeholder="Name or email"
            onDebouncedChange={setTerm}
            aria-label="Search accounts"
          />
        </div>
        <div className="w-full sm:w-52">
          <Field label="Status">
            <Select
              value={isActive}
              onChange={(event) => setIsActive(event.target.value)}
              options={ACTIVE_OPTIONS}
            />
          </Field>
        </div>
        {usersScope ? (
          <div className="w-full sm:w-44">
            <Field label="Role">
              <Select
                value={role}
                onChange={(event) => setRole(event.target.value)}
                options={ROLE_OPTIONS}
              />
            </Field>
          </div>
        ) : null}
      </FilterBar>

      <AdminTable
        query={query}
        columns={columns}
        caption={usersScope ? 'Every account on the platform' : 'Patient accounts'}
        empty={(
          <EmptyState
            icon={filtersDirty
              ? <Search className="h-6 w-6" aria-hidden="true" />
              : <Users className="h-6 w-6" aria-hidden="true" />}
            title={filtersDirty ? 'No account matches' : 'No accounts yet'}
            description={filtersDirty
              ? 'Try part of a name or email, or widen the status filter.'
              : 'Registrations will appear here as soon as somebody signs up.'}
            action={filtersDirty
              ? <Button variant="outline" size="sm" onClick={resetFilters}>Clear filters</Button>
              : undefined}
          />
        )}
        mobileCard={(row) => {
          const reason = statusLockReason(row, user?.id);
          const suspending = row.is_active !== false;
          return (
            <div className={cn(
              'flex flex-col gap-3 rounded-lg border p-4',
              row.is_root
                ? 'border-warning-300 bg-warning-50/60 dark:border-warning-800 dark:bg-warning-950/20'
                : 'border-subtle bg-surface',
            )}
            >
              <div className="flex items-start gap-3">
                <Avatar name={row.name || row.email} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                    {row.name || 'Unnamed account'}
                  </p>
                  <p className="truncate text-caption text-muted">{row.email}</p>
                </div>
                {row.is_active === false
                  ? <Badge tone="danger" size="sm">Suspended</Badge>
                  : <Badge tone="success" size="sm">Active</Badge>}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-caption text-muted">
                {row.role ? <RoleBadge role={row.role} size="sm" /> : null}
                {row.is_root ? (
                  <Badge tone="warning" size="sm" icon={<Lock className="h-3 w-3" aria-hidden="true" />}>
                    Protected
                  </Badge>
                ) : null}
                <span>Joined {formatDate(row.created_at)}</span>
                {typeof row.scan_count === 'number' ? <span>· {row.scan_count} scans</span> : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setForm({ mode: 'edit', row })}
                  leftIcon={<Pencil className="h-4 w-4" aria-hidden="true" />}
                >
                  Edit
                </Button>
                {reason ? (
                  <Tooltip content={reason}>
                    <span className="inline-flex">
                      <Button size="sm" variant="ghost" disabled>
                        {suspending ? 'Suspend' : 'Reactivate'}
                      </Button>
                    </span>
                  </Tooltip>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(row)}
                    className={suspending
                      ? 'text-danger-600 hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-950/40'
                      : undefined}
                  >
                    {suspending ? 'Suspend' : 'Reactivate'}
                  </Button>
                )}
                {/* align="left": on a phone card the trigger sits at the left
                    edge, so a right-anchored panel would open off-screen. */}
                <RowActions
                  label={`Actions for ${row.name || row.email}`}
                  actions={rowActions(row)}
                  align="left"
                  className="ml-auto"
                />
              </div>
            </div>
          );
        }}
      />

      <StatusModal
        row={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        onChanged={query.patchItem}
      />

      <AccountFormModal
        mode={form?.mode || 'create'}
        open={Boolean(form)}
        row={form?.row || null}
        defaultRole={ROLES.PATIENT}
        onClose={() => setForm(null)}
        onSaved={(result, mode) => {
          // A create can land outside the active filter (a new account is
          // `is_active: true`, and the roster is ordered by created_at DESC), so
          // refetch rather than splice a row into a page it may not belong on.
          // An edit is a known row: patch it in place and keep the scroll.
          if (mode === 'create') query.refetch();
          else if (result?.id) query.patchItem(result.id, result);
        }}
      />

      <ResetPasswordDialog
        row={resetting}
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
      />

      <DeleteAccountDialog
        row={deleting}
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onDeleted={query.removeItem}
        onSuspendInstead={() => setEditing(deleting)}
      />

      <BookAppointmentDrawer
        open={Boolean(booking)}
        patient={booking?.patient || undefined}
        onClose={() => setBooking(null)}
        onBooked={query.refetch}
      />

      <ActAsConfirmDialog
        target={actingTarget}
        open={Boolean(actingTarget)}
        onClose={() => setActingTarget(null)}
      />
    </AdminPage>
  );
}
