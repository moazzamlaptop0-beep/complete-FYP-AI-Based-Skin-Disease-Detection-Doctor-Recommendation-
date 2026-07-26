/**
 * AdminDoctorsPage — the licence verification queue.
 *
 * THE ENDPOINT IS THE ODD ONE OUT
 * -------------------------------
 * `/admin/doctors` is one of the frozen 39 and answers a BARE ARRAY, not the
 * `{items,page,per_page,total,has_more}` envelope the phase-2A console routes
 * use. `usePaginatedQuery` accepts both, so this page shares the hook with the
 * other four and simply gets `serverPaginated: false` — which is why the search
 * box and the paginator here are client-side. Do not "fix" this by assuming an
 * envelope: the backend really does return `data: [...]`.
 *
 * WHY VERIFICATION IS THE WHOLE PAGE
 * ----------------------------------
 * A doctor with `verification_status: 'pending'` cannot take a patient. The
 * queue therefore opens on Pending, not on All, and every row leads with the
 * three facts an admin actually checks — licence number, specialty and hospital
 * — instead of burying them behind a row click. The decision itself carries a
 * note, because "rejected" with no reason is not a decision anyone can appeal.
 *
 * TWO DESTRUCTIVE PATHS, DELIBERATELY DIFFERENT
 * ---------------------------------------------
 * Rejecting is reversible bookkeeping: the account survives, the status flips,
 * the note explains. DELETE is for a fake signup and cascades the whole account
 * away, so it sits behind a typed confirmation and says so.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CalendarPlus,
  IdCard,
  KeyRound,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Search,
  ShieldAlert,
  Stethoscope,
  Trash2,
  UserPlus,
  XCircle,
} from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  ModalFooter,
  RadioGroup,
  SearchInput,
  Textarea,
  cn,
  notify,
} from '../../components/ui';
import { del, put } from '../../lib/api';
import { admin as adminEndpoints } from '../../lib/endpoints';
import { formatDate } from '../../lib/format';
import { ROLES } from '../../lib/permissions';
import { useAuth } from '../../context/AuthContext';
import { AdminPage, AdminTable, FilterBar, SegmentedFilter, StackCell } from './components/AdminPage';
import AccountFormModal from './components/AccountFormModal';
import { ResetPasswordDialog } from './components/AccountDangerDialogs';
import { accountActionLock } from './components/accountLocks';
import BookAppointmentDrawer from './components/BookAppointmentDrawer';
import { ImpersonationNotice } from './components/ImpersonationNotice';
import RowActions from './components/RowActions';
import { ActAsConfirmDialog, ViewAsPicker, blockedReason } from './components/ViewAsPicker';
import { usePaginatedQuery } from './hooks/usePaginatedQuery';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: '', label: 'All' },
];

const PAGE_SIZE = 20;

const STATUS_TONE = {
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
};

function VerificationBadge({ status }) {
  const value = String(status || 'pending').toLowerCase();
  return (
    <Badge tone={STATUS_TONE[value] || 'neutral'} dot>
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </Badge>
  );
}

/** One labelled fact in the review sheet. */
function Fact({ icon: Icon, label, value, missing = 'Not provided' }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-caption text-muted">{label}</dt>
        <dd className={cn('break-words text-body-sm', empty ? 'italic text-muted' : 'text-neutral-900 dark:text-neutral-100')}>
          {empty ? missing : value}
        </dd>
      </div>
    </div>
  );
}

/**
 * The review sheet: every licence fact, then the decision.
 * `action` is exactly 'approve' | 'reject' — the backend 400s on anything else.
 */
function ReviewModal({ doctor, open, onClose, onDecided }) {
  const [action, setAction] = useState('approve');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Re-arm whenever a different doctor is opened.
  const doctorId = doctor?.id;
  React.useEffect(() => {
    setAction(doctor?.verification_status === 'approved' ? 'reject' : 'approve');
    setNote('');
    setError(null);
  }, [doctorId, doctor?.verification_status]);

  if (!doctor) return null;

  const submit = async () => {
    if (action === 'reject' && !note.trim()) {
      setError('A rejection needs a reason — the doctor sees this note.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await put(adminEndpoints.verifyDoctor(doctor.id), { action, note: note.trim() });
      const nextStatus = action === 'approve' ? 'approved' : 'rejected';
      notify.success(`${doctor.name || 'Doctor'} ${nextStatus}.`);
      onDecided(doctor.id, {
        verification_status: nextStatus,
        verification_note: note.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err?.message || 'The decision could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const missingLicence = !doctor.license;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={doctor.name || 'Doctor account'}
      description={doctor.email}
      footer={
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={action === 'approve' ? 'success' : 'danger'}
            onClick={submit}
            loading={busy}
            leftIcon={action === 'approve'
              ? <BadgeCheck className="h-4 w-4" aria-hidden="true" />
              : <XCircle className="h-4 w-4" aria-hidden="true" />}
          >
            {action === 'approve' ? 'Approve licence' : 'Reject application'}
          </Button>
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <VerificationBadge status={doctor.verification_status} />
          {doctor.is_email_verified
            ? <Badge tone="success" variant="outline">Email verified</Badge>
            : <Badge tone="warning" variant="outline">Email unverified</Badge>}
          <span className="text-caption text-muted">
            Registered {formatDate(doctor.created_at)}
          </span>
        </div>

        {missingLicence ? (
          <Alert tone="warning" title="No licence on file">
            This account has no doctor profile yet, so there is nothing to check. Approving it
            would let them take patients on an unverified licence.
          </Alert>
        ) : null}

        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact icon={IdCard} label="Licence number" value={doctor.license} missing="No licence submitted" />
          <Fact icon={Stethoscope} label="Specialty" value={doctor.specialty} />
          <Fact icon={Building2} label="Hospital / clinic" value={doctor.hospital} />
          <Fact icon={MapPin} label="City" value={doctor.city} />
          <Fact icon={Phone} label="Phone" value={doctor.phone} />
          <Fact icon={Mail} label="Email" value={doctor.email} />
        </dl>

        {doctor.verification_note ? (
          <Alert tone="neutral" title="Previous decision note">
            {doctor.verification_note}
            {doctor.verified_at ? (
              <span className="mt-1 block text-caption text-muted">
                Decided {formatDate(doctor.verified_at)}
              </span>
            ) : null}
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-subtle pt-4">
          <RadioGroup
            name="verify-action"
            legend="Decision"
            variant="card"
            value={action}
            onChange={setAction}
            options={[
              { value: 'approve', label: 'Approve', description: 'They can take patients immediately.' },
              { value: 'reject', label: 'Reject', description: 'The account stays, but stays unable to practise.' },
            ]}
          />

          <Field
            label="Note"
            hint={action === 'reject'
              ? 'Required. The doctor is shown this, so say what is missing or wrong.'
              : 'Optional. Recorded against the decision.'}
            error={error || undefined}
          >
            <Textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={action === 'reject'
                ? 'e.g. The licence number does not match the PMDC register.'
                : 'e.g. Licence checked against the PMDC register on 25 July.'}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** DELETE cascades the account away. Typed confirmation, matching the tone. */
function DeleteDoctorDialog({ doctor, open, onClose, onDeleted }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    setTyped('');
    setError(null);
  }, [doctor?.id, open]);

  if (!doctor) return null;

  const armed = typed.trim().toUpperCase() === 'DELETE';

  const submit = async () => {
    if (!armed) return;
    setBusy(true);
    setError(null);
    try {
      await del(adminEndpoints.deleteDoctor(doctor.id));
      notify.success(`${doctor.name || 'Doctor'} deleted.`);
      onDeleted(doctor.id);
      onClose();
    } catch (err) {
      // 400 here is the FK guard: "doctor has linked records that block deletion."
      setError(err?.message || 'The account could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Delete this doctor account"
      description={`${doctor.name || 'This account'} — ${doctor.email}`}
      footer={
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={!armed}
            loading={busy}
            leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          >
            Delete permanently
          </Button>
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert tone="danger" title="This cannot be undone" icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}>
          The user row and everything cascading from it are removed. Use this only for a fake or
          duplicate signup. To stop a real clinician practising, <strong>reject their licence</strong>
          {' '}instead — that keeps the record and the reason.
        </Alert>
        <p className="text-body-sm text-muted">
          If this doctor already has patients, scans or appointments the server will refuse and tell
          you so; suspend them from the Patients &amp; users page instead.
        </p>
        <Field label="Type DELETE to confirm" error={error || undefined}>
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            placeholder="DELETE"
            aria-describedby={undefined}
          />
        </Field>
      </div>
    </Modal>
  );
}

export default function AdminDoctorsPage() {
  const { user, actingAs } = useAuth();
  const [status, setStatus] = useState('pending');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [form, setForm] = useState(null);          // {mode, row}
  const [resetting, setResetting] = useState(null);
  const [booking, setBooking] = useState(null);    // {doctor}
  const [actingTarget, setActingTarget] = useState(null);

  const filters = useMemo(() => ({ status }), [status]);

  const query = usePaginatedQuery({
    path: adminEndpoints.doctors,
    filters,
    paginate: false,
    enabled: !actingAs,
  });

  // Client-side, because the endpoint has no `q` param and returns everything.
  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return query.items;
    return query.items.filter((row) => [
      row.name, row.email, row.license, row.specialty, row.hospital, row.city, row.phone,
    ].some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [query.items, term]);

  const visible = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  // A filter or search that shrinks the list past the current page must not
  // leave the admin staring at an empty table.
  React.useEffect(() => { setPage(1); }, [status, term]);

  /**
   * The overflow menu for one doctor row.
   *
   * `/admin/doctors` is one of the frozen 39 and its 13 keys do NOT include
   * `role`, `is_root` or `is_active` — so the target handed to the lock helpers
   * has `role: 'Doctor'` and `is_active: true` supplied here. Every row on this
   * page IS a doctor (the query filters on it), and a suspended one is the single
   * case the UI cannot pre-empt: the server answers "Delegation target is
   * deactivated." and the toast carries it. Adding `is_active` to that response
   * would change a frozen contract for a cosmetic gain.
   */
  const rowActions = (row) => {
    const target = { ...row, role: ROLES.DOCTOR, is_active: true };
    const approved = String(row.verification_status || 'pending') === 'approved';

    return [
      {
        id: 'edit',
        label: 'Edit licence & clinic…',
        icon: Pencil,
        onSelect: () => setForm({ mode: 'edit', row }),
      },
      {
        id: 'reset',
        label: 'Reset password…',
        icon: KeyRound,
        disabledReason: accountActionLock(target, user, 'reset'),
        onSelect: () => setResetting(row),
      },
      {
        id: 'book',
        label: 'Book a patient with them…',
        icon: CalendarPlus,
        // A pending or rejected licence means no published hours and no patients,
        // so the slot grid would be empty with no explanation.
        disabledReason: approved
          ? null
          : 'Approve their licence first — an unverified doctor cannot take patients.',
        onSelect: () => setBooking({ doctor: row }),
      },
      {
        id: 'act-as',
        label: 'Act as this doctor…',
        icon: ShieldAlert,
        disabledReason: blockedReason(target, user?.role),
        onSelect: () => setActingTarget(target),
        separatorBefore: true,
      },
      {
        id: 'delete',
        label: 'Delete account…',
        icon: Trash2,
        danger: true,
        onSelect: () => setDeleting(row),
        separatorBefore: true,
      },
    ];
  };

  const columns = [
    {
      key: 'name',
      header: 'Doctor',
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.name || row.email} size="sm" />
          <StackCell primary={row.name || 'Unnamed'} secondary={row.email} />
        </div>
      ),
    },
    {
      key: 'license',
      header: 'Licence',
      render: (row) => (
        row.license
          ? <span className="font-mono text-body-sm">{row.license}</span>
          : <span className="text-caption italic text-muted">No profile yet</span>
      ),
    },
    {
      key: 'specialty',
      header: 'Specialty',
      hideOnMobile: true,
      render: (row) => <StackCell primary={row.specialty || '—'} secondary={row.hospital || undefined} />,
    },
    {
      key: 'city',
      header: 'City',
      hideOnMobile: true,
      render: (row) => row.city || '—',
    },
    {
      key: 'verification_status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <VerificationBadge status={row.verification_status} />
          {!row.is_email_verified ? (
            <span className="text-caption text-warning-700 dark:text-warning-400">Email unverified</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'created_at',
      header: 'Registered',
      hideOnMobile: true,
      render: (row) => <span className="whitespace-nowrap text-body-sm">{formatDate(row.created_at)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {/* Review stays the labelled button: this page opens on the pending
              queue, and vetting a licence is the reason to be here. */}
          <Button size="sm" variant="outline" onClick={() => setReviewing(row)}>
            Review
          </Button>
          <RowActions
            label={`Actions for ${row.name || row.email}`}
            actions={rowActions(row)}
          />
        </div>
      ),
    },
  ];

  const pendingCount = query.items.filter(
    (row) => String(row.verification_status || 'pending') === 'pending',
  ).length;

  return (
    <AdminPage
      title="Doctors"
      description="Check a licence before a clinician can take patients. Approving is immediate; rejecting keeps the account but blocks practice. You can also add a doctor yourself, edit their clinic details, or reset their password."
      actions={(
        <>
          <Button
            variant="primary"
            onClick={() => setForm({ mode: 'create', row: null })}
            leftIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
            disabled={Boolean(actingAs)}
          >
            Add doctor
          </Button>
          <ViewAsPicker />
        </>
      )}
      banner={<ImpersonationNotice />}
      paused={Boolean(actingAs)}
    >
      {status === 'pending' && pendingCount > 0 ? (
        <Alert tone="warning" title={`${pendingCount} doctor${pendingCount === 1 ? '' : 's'} waiting for a decision`}>
          Nobody in this list can accept a referral or publish a schedule until you approve them.
        </Alert>
      ) : null}

      <FilterBar onRefresh={query.refetch} busy={query.refreshing}>
        <SegmentedFilter
          label="Verification status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={setStatus}
        />
        <div className="w-full sm:w-72">
          <SearchInput
            placeholder="Name, email, licence, hospital"
            onDebouncedChange={setTerm}
            aria-label="Search doctors"
          />
        </div>
      </FilterBar>

      <AdminTable
        query={query}
        columns={columns}
        rows={visible}
        caption="Doctor accounts and their licence verification status"
        empty={(
          <EmptyState
            icon={term
              ? <Search className="h-6 w-6" aria-hidden="true" />
              : <BadgeCheck className="h-6 w-6" aria-hidden="true" />}
            title={term ? 'No doctor matches that search' : 'Nothing in this queue'}
            description={term
              ? 'Try a licence number, a hospital name or part of an email.'
              : status === 'pending'
                ? 'Every licence has been reviewed. New signups will appear here.'
                : 'No doctor currently has this status.'}
            action={term || status !== 'pending'
              ? <Button variant="outline" size="sm" onClick={() => { setTerm(''); setStatus('pending'); }}>
                Back to the pending queue
              </Button>
              : undefined}
          />
        )}
        pagination={filtered.length > PAGE_SIZE ? {
          page,
          pageSize: PAGE_SIZE,
          total: filtered.length,
          onPageChange: setPage,
        } : undefined}
      />

      <ReviewModal
        doctor={reviewing}
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        onDecided={(id, patch) => {
          query.patchItem(id, patch);
          // The row may no longer belong to the active status filter.
          if (status) query.refetch();
        }}
      />

      <DeleteDoctorDialog
        doctor={deleting}
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onDeleted={query.removeItem}
      />

      <AccountFormModal
        mode={form?.mode || 'create'}
        open={Boolean(form)}
        row={form?.row || null}
        defaultRole={ROLES.DOCTOR}
        onClose={() => setForm(null)}
        onSaved={() => {
          // Always a refetch, never a patchItem. A new doctor is created
          // 'pending' and this page opens on the Pending filter, so the row
          // belongs on screen — but the PATCH response nests the licence fields
          // under `doctor` while this endpoint returns them FLAT (its 13 frozen
          // keys), so folding one into the other would render `undefined` in the
          // Licence column.
          query.refetch();
        }}
      />

      <ResetPasswordDialog
        row={resetting}
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
      />

      <BookAppointmentDrawer
        open={Boolean(booking)}
        doctor={booking?.doctor || undefined}
        onClose={() => setBooking(null)}
      />

      <ActAsConfirmDialog
        target={actingTarget}
        open={Boolean(actingTarget)}
        onClose={() => setActingTarget(null)}
      />
    </AdminPage>
  );
}
