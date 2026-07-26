/**
 * AdminAuditLogPage — what makes impersonation accountable instead of invisible.
 *
 * WHY THIS IS A TIMELINE AND NOT A TABLE OF JSON
 * ---------------------------------------------
 * `audit_logs` is the record that answers "who looked at my photos, and who
 * changed my account". A grid of `actor_user_id | action | target_id | detail`
 * is technically complete and practically unreadable — nobody audits anything
 * by joining ids in their head. Every row here is rendered as a SENTENCE:
 * who did what, to whom, when. The raw fields are still one click away, because
 * an audit trail you cannot verify literally is not one.
 *
 * THE act_as COLLAPSE
 * -------------------
 * `require_permission` writes one `act_as` row for EVERY request made while
 * `X-Act-As-User-Id` is set — a five-minute impersonation is dozens of rows.
 * Left raw, they bury every other action on the page. Consecutive `act_as` rows
 * with the same actor and the same subject are therefore folded into one
 * session entry ("acted as Ali Raza — 14 requests, 15:02 to 15:09") which
 * expands to the individual `METHOD /path` lines. Nothing is hidden and nothing
 * is summarised away; the rows are simply grouped by the thing they describe.
 *
 * The fold is deliberately conservative: it only merges rows that are ADJACENT
 * in the server's `created_at DESC, id DESC` order, so an unrelated action in
 * the middle always splits the session and stays visible in sequence.
 */

import React, { useMemo, useState } from 'react';
import {
  Activity,
  ChevronDown,
  FileCheck,
  Filter,
  ImageOff,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
} from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
  cn,
} from '../../components/ui';
import { admin as adminEndpoints } from '../../lib/endpoints';
import { formatDate, formatDateTime, formatRelativeTime, formatTime } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { AdminPage, FilterBar, SegmentedFilter } from './components/AdminPage';
import { ImpersonationNotice } from './components/ImpersonationNotice';
import { ViewAsPicker } from './components/ViewAsPicker';
import { usePaginatedQuery } from './hooks/usePaginatedQuery';

/**
 * The controlled action vocabulary, turned into readable verbs.
 * `subjectVerb` is used when the subject is somebody OTHER than the actor,
 * because "Ayesha suspended themselves" and "Ayesha suspended Ali" need
 * different grammar and the same row shape produces both.
 */
const ACTIONS = {
  act_as: {
    verb: 'acted as',
    icon: ShieldAlert,
    tone: 'danger',
    impersonation: true,
    blurb: 'Performed a request inside someone else’s account.',
  },
  'user.status.change': {
    verb: 'changed the account status of',
    reflexive: 'changed their own account status',
    icon: UserCog,
    tone: 'warning',
  },
  'scan.hard_delete': {
    verb: 'permanently destroyed a scan belonging to',
    reflexive: 'permanently destroyed their own scan',
    icon: Trash2,
    tone: 'danger',
  },
  'scan.image_delete': {
    verb: 'deleted the photo from a scan belonging to',
    reflexive: 'deleted their own scan photo',
    icon: ImageOff,
    tone: 'warning',
  },
  'doctor.verify': {
    verb: 'reviewed the licence of',
    icon: ShieldCheck,
    tone: 'primary',
  },
  'auth.login': { verb: 'signed in as', reflexive: 'signed in', icon: LogIn, tone: 'neutral' },
  'auth.logout': { verb: 'signed out', reflexive: 'signed out', icon: LogOut, tone: 'neutral' },
  'auth.logout_all': {
    verb: 'ended every session of',
    reflexive: 'ended all of their sessions',
    icon: LogOut,
    tone: 'neutral',
  },
  'auth.register': { verb: 'created the account', reflexive: 'created their account', icon: UserPlus, tone: 'success' },
  'auth.email_change': {
    verb: 'changed the email address of',
    reflexive: 'changed their email address',
    icon: Mail,
    tone: 'neutral',
  },
  'password.reset': {
    verb: 'reset the password of',
    reflexive: 'reset their password',
    icon: KeyRound,
    tone: 'warning',
  },
  'consent.record': {
    verb: 'recorded consent for',
    reflexive: 'recorded their consent',
    icon: FileCheck,
    tone: 'neutral',
  },
};

/** Unknown actions still read as English rather than a raw key. */
function describe(action) {
  const known = ACTIONS[action];
  if (known) return known;
  const words = String(action || 'acted')
    .replace(/[._]/g, ' ')
    .trim();
  return { verb: words, reflexive: words, icon: Activity, tone: 'neutral' };
}

const QUICK_FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'act_as', label: 'Impersonation' },
  { value: 'user.', label: 'Account changes', prefix: true },
  { value: 'scan.', label: 'Deletions', prefix: true },
  { value: 'auth.', label: 'Sign-ins', prefix: true },
];

const TARGET_TYPES = [
  { value: '', label: 'Any target' },
  { value: 'user', label: 'User' },
  { value: 'scan', label: 'Scan' },
  { value: 'appointment', label: 'Appointment' },
  { value: 'doctor', label: 'Doctor profile' },
];

const personLabel = (name, email, id, fallback = 'the system') => {
  if (name) return name;
  if (email) return email;
  if (id) return `User #${id}`;
  return fallback;
};

/**
 * Fold adjacent `act_as` rows by (actor, subject) into one session entry.
 * @param {Array<object>} rows Server order: created_at DESC, id DESC.
 */
export function groupEntries(rows) {
  const out = [];
  rows.forEach((row) => {
    const previous = out[out.length - 1];
    if (
      row.action === 'act_as'
      && previous?.kind === 'session'
      && previous.actorId === row.actor_user_id
      && previous.subjectId === row.subject_user_id
    ) {
      previous.rows.push(row);
      return;
    }
    if (row.action === 'act_as') {
      out.push({
        kind: 'session',
        id: `session-${row.id}`,
        actorId: row.actor_user_id,
        subjectId: row.subject_user_id,
        rows: [row],
      });
      return;
    }
    out.push({ kind: 'entry', id: `entry-${row.id}`, row });
  });
  return out;
}

/** One non-impersonation event, as a sentence. */
function LogEntry({ row }) {
  const [open, setOpen] = useState(false);
  const meta = describe(row.action);
  const Icon = meta.icon;

  const actor = personLabel(row.actor_name, row.actor_email, row.actor_user_id);
  const sameParty = row.subject_user_id && row.subject_user_id === row.actor_user_id;
  const subject = personLabel(row.subject_name, row.subject_email, row.subject_user_id, null);

  return (
    <li className="relative flex gap-3 pl-1">
      <span
        className={cn(
          'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full',
          meta.tone === 'danger' && 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300',
          meta.tone === 'warning' && 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
          meta.tone === 'success' && 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
          meta.tone === 'primary' && 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
          meta.tone === 'neutral' && 'bg-surface-sunken text-muted',
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1 pb-4">
        <p className="text-body-sm text-neutral-800 dark:text-neutral-200">
          <strong className="font-semibold text-neutral-900 dark:text-neutral-50">{actor}</strong>
          {' '}
          {sameParty || !subject ? (meta.reflexive || meta.verb) : (
            <>
              {meta.verb}
              {' '}
              <strong className="font-semibold text-neutral-900 dark:text-neutral-50">{subject}</strong>
            </>
          )}
          {row.target_type && row.target_id && row.target_type !== 'user' ? (
            <span className="text-muted"> ({row.target_type} #{row.target_id})</span>
          ) : null}
        </p>

        {row.detail ? (
          <p className="mt-0.5 break-words text-caption text-muted">{row.detail}</p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
          <time dateTime={row.created_at}>{formatTime(row.created_at)}</time>
          <span>{formatRelativeTime(row.created_at)}</span>
          <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono">{row.action}</code>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-neutral-200"
          >
            Raw record
            <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </button>
        </div>

        {open ? (
          <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-md border border-subtle bg-surface-sunken p-2.5 text-caption sm:grid-cols-2">
            <div><dt className="inline text-muted">id: </dt><dd className="inline font-mono">{row.id}</dd></div>
            <div><dt className="inline text-muted">actor_user_id: </dt><dd className="inline font-mono">{row.actor_user_id ?? '—'}</dd></div>
            <div><dt className="inline text-muted">subject_user_id: </dt><dd className="inline font-mono">{row.subject_user_id ?? '—'}</dd></div>
            <div><dt className="inline text-muted">target: </dt><dd className="inline font-mono">{row.target_type || '—'} #{row.target_id ?? '—'}</dd></div>
            <div><dt className="inline text-muted">ip: </dt><dd className="inline font-mono">{row.ip || '—'}</dd></div>
            <div><dt className="inline text-muted">at: </dt><dd className="inline font-mono">{formatDateTime(row.created_at)}</dd></div>
            <div className="sm:col-span-2">
              <dt className="inline text-muted">user_agent: </dt>
              <dd className="inline break-all font-mono">{row.user_agent || '—'}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </li>
  );
}

/** A folded run of `act_as` rows — one impersonation session. */
function SessionEntry({ group }) {
  const [open, setOpen] = useState(false);
  const rows = group.rows;
  const first = rows[0];
  const last = rows[rows.length - 1];

  const actor = personLabel(first.actor_name, first.actor_email, first.actor_user_id);
  const subject = personLabel(first.subject_name, first.subject_email, first.subject_user_id, 'another account');

  return (
    <li className="relative flex gap-3 pl-1">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1 pb-4">
        <div className="rounded-lg border border-danger-200 bg-danger-50/60 p-3 dark:border-danger-900 dark:bg-danger-950/30">
          <p className="text-body-sm text-neutral-800 dark:text-neutral-200">
            <strong className="font-semibold text-neutral-900 dark:text-neutral-50">{actor}</strong>
            {' acted as '}
            <strong className="font-semibold text-neutral-900 dark:text-neutral-50">{subject}</strong>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
            <Badge tone="danger" size="sm" variant="outline">Impersonation</Badge>
            <span>
              {rows.length} request{rows.length === 1 ? '' : 's'}
            </span>
            <span>
              {formatTime(last.created_at)} – {formatTime(first.created_at)}
            </span>
            <span>{formatRelativeTime(first.created_at)}</span>
            {first.ip ? <span className="font-mono">{first.ip}</span> : null}
          </div>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="mt-2 inline-flex items-center gap-0.5 text-caption underline decoration-dotted underline-offset-2 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-neutral-200"
          >
            {open ? 'Hide' : 'Show'} every request in this session
            <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </button>

          {open ? (
            <ol className="mt-2 flex flex-col gap-1 border-t border-danger-200 pt-2 dark:border-danger-900">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline gap-x-2 text-caption">
                  <time dateTime={row.created_at} className="tabular-nums text-muted">
                    {formatTime(row.created_at)}
                  </time>
                  <code className="break-all font-mono text-neutral-800 dark:text-neutral-200">
                    {row.detail || '—'}
                  </code>
                  <span className="text-muted">#{row.id}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function AdminAuditLogPage() {
  const { actingAs } = useAuth();
  const [quick, setQuick] = useState('');
  const [actor, setActor] = useState('');
  const [subject, setSubject] = useState('');
  const [targetType, setTargetType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const quickOption = QUICK_FILTERS.find((option) => option.value === quick);

  const filters = useMemo(() => ({
    // `action` matches exactly; `action_prefix` is the ILIKE 'prefix%' variant.
    action: quickOption?.prefix ? '' : quick,
    action_prefix: quickOption?.prefix ? quick : '',
    actor,
    subject,
    target_type: targetType,
    date_from: dateFrom,
    date_to: dateTo,
  }), [quick, quickOption, actor, subject, targetType, dateFrom, dateTo]);

  const query = usePaginatedQuery({
    path: adminEndpoints.auditLog,
    filters,
    perPage: 50,
    enabled: !actingAs,
  });

  // The two SearchInputs are uncontrolled; remount them so a reset visibly
  // clears the boxes as well as the query.
  const [resetKey, setResetKey] = useState(0);

  const dirty = Boolean(quick || actor || subject || targetType || dateFrom || dateTo);
  const reset = () => {
    setQuick('');
    setActor('');
    setSubject('');
    setTargetType('');
    setDateFrom('');
    setDateTo('');
    setResetKey((n) => n + 1);
  };

  // Group by calendar day first (the heading), then fold act_as runs within it.
  const days = useMemo(() => {
    const buckets = [];
    const byLabel = new Map();
    query.items.forEach((row) => {
      const label = formatDate(row.created_at);
      if (!byLabel.has(label)) {
        const bucket = { label, rows: [] };
        byLabel.set(label, bucket);
        buckets.push(bucket);
      }
      byLabel.get(label).rows.push(row);
    });
    return buckets.map((bucket) => ({ ...bucket, entries: groupEntries(bucket.rows) }));
  }, [query.items]);

  return (
    <AdminPage
      title="Audit log"
      description="Who did what, to whom, and when. Every request made while acting as somebody else is in here, attributed to the admin who made it."
      actions={<ViewAsPicker />}
      banner={<ImpersonationNotice />}
      paused={Boolean(actingAs)}
    >
      <FilterBar onRefresh={query.refetch} busy={query.refreshing} onReset={dirty ? reset : undefined}>
        <SegmentedFilter
          label="Kind of event"
          options={QUICK_FILTERS}
          value={quick}
          onChange={setQuick}
        />
        <div className="w-full sm:w-52">
          <SearchInput
            key={`actor-${resetKey}`}
            placeholder="Actor: name, email or id"
            onDebouncedChange={setActor}
            aria-label="Filter by who performed the action"
          />
        </div>
        <div className="w-full sm:w-52">
          <SearchInput
            key={`subject-${resetKey}`}
            placeholder="Subject: name, email or id"
            onDebouncedChange={setSubject}
            aria-label="Filter by who it was done to"
          />
        </div>
        <div className="w-full sm:w-44">
          <Field label="Target">
            <Select
              value={targetType}
              onChange={(event) => setTargetType(event.target.value)}
              options={TARGET_TYPES}
            />
          </Field>
        </div>
        <div className="w-full sm:w-40">
          <Field label="From">
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </Field>
        </div>
        <div className="w-full sm:w-40">
          <Field label="To">
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </Field>
        </div>
      </FilterBar>

      {query.error ? (
        <Alert
          tone="danger"
          title="Could not load the audit log"
          actions={<Button size="sm" variant="outline" onClick={query.refetch}>Try again</Button>}
        >
          {query.error.message}
        </Alert>
      ) : query.loading ? (
        <Card padding="md">
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the audit log">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton shape="circle" width={32} height={32} />
                <div className="flex-1">
                  <Skeleton width="70%" />
                  <Skeleton width="40%" className="mt-1.5" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : query.items.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={dirty
              ? <Filter className="h-6 w-6" aria-hidden="true" />
              : <ScrollText className="h-6 w-6" aria-hidden="true" />}
            title={dirty ? 'No recorded action matches' : 'Nothing recorded yet'}
            description={dirty
              ? 'Try a wider date range, or search the actor by email instead of name.'
              : 'Suspensions, deletions and impersonation sessions are written here as they happen.'}
            action={dirty
              ? <Button variant="outline" size="sm" onClick={reset}>Clear filters</Button>
              : undefined}
          />
        </Card>
      ) : (
        <div className={cn('flex flex-col gap-5', query.refreshing && 'opacity-60 transition-opacity')}>
          {days.map((day) => (
            <Card key={day.label} padding="md">
              <h2 className="mb-3 text-heading-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {day.label}
                <span className="ml-2 text-caption font-normal text-muted">
                  {day.rows.length} record{day.rows.length === 1 ? '' : 's'}
                </span>
              </h2>
              <ol className="flex flex-col">
                {day.entries.map((entry) => (
                  entry.kind === 'session'
                    ? <SessionEntry key={entry.id} group={entry} />
                    : <LogEntry key={entry.id} row={entry.row} />
                ))}
              </ol>
            </Card>
          ))}

          {query.total > query.perPage ? (
            <Pagination
              page={query.page}
              pageSize={query.perPage}
              total={query.total}
              onPageChange={query.setPage}
              onPageSizeChange={query.setPerPage}
              pageSizeOptions={[25, 50, 100]}
            />
          ) : null}
        </div>
      )}
    </AdminPage>
  );
}
