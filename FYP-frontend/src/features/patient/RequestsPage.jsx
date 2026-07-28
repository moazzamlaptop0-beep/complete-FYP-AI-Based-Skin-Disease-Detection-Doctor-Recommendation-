/**
 * PatientRequestsPage — the consultation requests you sent to several doctors at
 * once, and who replied.
 *
 * WHY THIS PAGE HAS NO PREDECESSOR
 * --------------------------------
 * There was nothing to show before. `/send_report` attached a scan to exactly
 * ONE doctor and returned; there was no record a patient could revisit, no way
 * to see whether that doctor had even looked at it, and no way to withdraw. The
 * multi-doctor request replaces that, and this page is its whole visible surface:
 * who was invited, what each of them said, which times were offered, and how long
 * is left before it expires.
 *
 * SERVER-SIDE PAGINATION, UNLIKE THE SCANS PAGE
 * --------------------------------------------
 * `/api/appointment-requests` really is paginated (`{items, page, limit, total,
 * pages}`) and really does take `?status=`, so both live in the URL and both are
 * sent to the server — the opposite decision to ScansPage, where the endpoint
 * takes no parameters at all and filtering client-side is the honest option.
 *
 * THREE THINGS A PATIENT CAN DO FROM HERE, NOT ONE
 * -----------------------------------------------
 * Withdraw used to be the only control on the page, which made every request
 * either untouchable or a dead end:
 *
 *   EDIT      an Open request — PATCH. Adding a sixth preferred time used to mean
 *             withdrawing (emailing three doctors that the case is closed) and
 *             rebuilding the whole thing from the photo upload.
 *   SEND AGAIN a Withdrawn / Expired / Declined one — POST, reusing the same
 *             scan, doctors and answers. Nothing on this page led anywhere from a
 *             closed request before, even though all of that was still on the
 *             server.
 *   WITHDRAW   as before.
 *
 * All three refetch rather than patching the row: an edit moves `expires_at` and
 * possibly the severity badge, and a re-send returns a NEW `request_id`, so a
 * patched row would render a request that does not exist.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, RefreshCw, ScanLine } from 'lucide-react';

import {
  Alert,
  Button,
  ConfirmDialog,
  DateRangeFilter,
  EmptyState,
  Field,
  Pagination,
  Select,
  SkeletonCard,
  Textarea,
  dateInRange,
  hasDateRange,
  notify,
} from '../../components/ui';
import { get, post } from '../../lib/api';
import { requests as requestEndpoints } from '../../lib/endpoints';
import { parseDate } from '../../lib/format';
import { PATHS } from '../../routes';

import PageHeader from './components/PageHeader';
import RequestCard from './components/RequestCard';
import RequestDetailDrawer from './components/RequestDetailDrawer';
import RequestEditDialog from './components/RequestEditDialog';
import { normalizeList, useResource } from './hooks/usePatientData';

const PAGE_SIZE = 10;

/** The five literals in app/models/enums.py — no invented statuses. */
const STATUS_OPTIONS = [
  { value: '', label: 'All requests' },
  { value: 'Open', label: 'Open' },
  { value: 'Matched', label: 'Accepted' },
  { value: 'Declined', label: 'Declined by all' },
  { value: 'Expired', label: 'Expired' },
  { value: 'Withdrawn', label: 'Withdrawn' },
];

export default function PatientRequestsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  /** `{mode, request}` for the edit / re-send dialog, or null when it is shut. */
  const [editing, setEditing] = useState(null);
  /** The row whose full record is open in the read-only drawer. */
  const [viewing, setViewing] = useState(null);

  const setParam = useCallback((key, value) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  const { data, loading, error, refetch } = useResource(
    (signal) => get(requestEndpoints.list({ page, limit: PAGE_SIZE, status: status || undefined }), { signal }),
    { deps: [page, status], initialData: null },
  );

  const { items, total } = useMemo(() => normalizeList(data), [data]);

  /** Sent-date filter, applied CLIENT-SIDE to the loaded page only: the list
   *  endpoint paginates on the server, so the caption under the filter counts
   *  "of the loaded requests" rather than pretending it searched everything.
   *  A row without a parseable created_at is kept, never hidden. */
  const [dateRange, setDateRange] = useState({ from: null, to: null });
  const dateFiltering = hasDateRange(dateRange);

  const visible = useMemo(() => {
    if (!dateFiltering) return items;
    return items.filter((request) => dateInRange(parseDate(request.created_at), dateRange));
  }, [items, dateRange, dateFiltering]);

  const openCancel = (request) => {
    setCancelling(request);
    setReason('');
    setCancelError(null);
  };

  const openEdit = useCallback((request) => setEditing({ mode: 'edit', request }), []);
  const openReapply = useCallback((request) => setEditing({ mode: 'reapply', request }), []);
  const closeEdit = useCallback(() => setEditing(null), []);
  const openDetails = useCallback((request) => setViewing(request), []);
  const closeDetails = useCallback(() => setViewing(null), []);

  const confirmCancel = async () => {
    if (!cancelling) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await post(requestEndpoints.cancel(cancelling.request_id), { reason: reason.trim() || undefined });
      notify.success('Request withdrawn. The doctors have been told.');
      setCancelling(null);
      refetch();
    } catch (err) {
      setCancelError(err?.message || 'The request could not be withdrawn.');
      // Rethrow-free: ConfirmDialog stays open so the message is readable.
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Consultation requests"
        description="Requests you sent to up to three doctors at once. The first to accept one of your times takes the appointment."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={refetch}
              loading={loading && items.length > 0}
            >
              Refresh
            </Button>
            <Button as={Link} to={PATHS.CONSULT} size="sm" leftIcon={<ScanLine className="h-4 w-4" />}>
              New request
            </Button>
          </>
        }
      >
        <Field label="Status" className="sm:w-52">
          <Select
            value={status}
            options={STATUS_OPTIONS}
            onChange={(event) => setParam('status', event.target.value)}
          />
        </Field>
      </PageHeader>

      <div className="mb-4 flex flex-col gap-2">
        <DateRangeFilter
          label="Sent between"
          value={dateRange}
          onChange={setDateRange}
        />
        {dateFiltering && !loading && items.length > 0 && (
          <p className="font-body text-caption text-muted" role="status">
            Showing {visible.length} of the {items.length} requests loaded on this page. Other
            pages are not searched.
          </p>
        )}
      </div>

      {error && (
        <Alert
          tone="danger"
          title="We could not load your requests"
          className="mb-4"
          actions={<Button size="sm" variant="outline" onClick={refetch}>Try again</Button>}
        >
          {error}
        </Alert>
      )}

      {loading && items.length === 0 && (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 2 }).map((_, index) => <SkeletonCard key={index} lines={4} />)}
        </div>
      )}

      {!loading && !error && items.length > 0 && visible.length === 0 && (
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" aria-hidden="true" />}
          title="No requests sent on those dates"
          description="Nothing on this page was sent inside the selected range. Widen it, or clear it."
          action={(
            <Button variant="outline" onClick={() => setDateRange({ from: null, to: null })}>
              Show all dates
            </Button>
          )}
        />
      )}

      {!loading && !error && items.length === 0 && (
        status ? (
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" aria-hidden="true" />}
            title="No requests with that status"
            description="Clear the filter to see everything you have sent."
            action={<Button variant="outline" onClick={() => setParam('status', '')}>Clear filter</Button>}
          />
        ) : (
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" aria-hidden="true" />}
            title="You have not sent a request yet"
            description="After a scan you can pick up to three dermatologists and offer up to five times that suit you. Whoever accepts first gets the appointment."
            action={<Button as={Link} to={PATHS.CONSULT}>Start a scan</Button>}
          />
        )
      )}

      {visible.length > 0 && (
        <ul className="flex flex-col gap-4">
          {visible.map((request) => (
            <li key={request.request_id}>
              <RequestCard
                request={request}
                onDetails={openDetails}
                onCancel={openCancel}
                onEdit={openEdit}
                onReapply={openReapply}
              />
            </li>
          ))}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <Pagination
          className="mt-4"
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(next) => setParam('page', next > 1 ? String(next) : '')}
        />
      )}

      {viewing && (
        <RequestDetailDrawer open request={viewing} onClose={closeDetails} />
      )}

      {/* Kept mounted only while it has a request: it seeds itself from that row
          on open, and the row is whatever the last refetch returned. */}
      {editing && (
        <RequestEditDialog
          open
          mode={editing.mode}
          request={editing.request}
          onClose={closeEdit}
          onDone={refetch}
        />
      )}

      <ConfirmDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        onConfirm={confirmCancel}
        closeOnConfirm={false}
        loading={cancelBusy}
        tone="danger"
        title="Withdraw this request?"
        description="Every doctor still waiting is told it is no longer open. Your scan and its diagnosis are untouched, and you can send a new request at any time."
        confirmLabel="Withdraw request"
        cancelLabel="Keep it open"
      >
        {/* ConfirmDialog centres its body; a form control has to opt back out. */}
        <div className="flex w-full flex-col gap-3 text-left">
          {cancelError && <Alert tone="danger">{cancelError}</Alert>}
          <Field label="Reason (optional)" hint="Shared with the doctors you invited.">
            <Textarea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. the rash has cleared up"
              maxLength={300}
            />
          </Field>
        </div>
      </ConfirmDialog>
    </>
  );
}
