/**
 * AdminOverviewPage — the admin console home.
 *
 * `GET /admin/stats` returns exactly four integers. Rather than dress them up
 * with a charting dependency they cannot support, each tile states the number,
 * says what it counts, and links to the page where you can act on it — a stat
 * you cannot act on is decoration.
 *
 * The one tile that is not neutral is the verification queue: pending doctors
 * are people who cannot practise on the platform until an admin looks at them,
 * so it turns warning-toned and jumps to the front of the grid when it is
 * non-zero.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  CalendarDays,
  ScanLine,
  ScrollText,
  Stethoscope,
  Users,
} from 'lucide-react';

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Skeleton,
  cn,
} from '../../components/ui';
import { ApiError, get } from '../../lib/api';
import { admin as adminEndpoints } from '../../lib/endpoints';
import { formatNumber } from '../../lib/format';
import { PATHS } from '../../routes';
import { useAuth } from '../../context/AuthContext';
import { AdminPage } from './components/AdminPage';
import { ImpersonationNotice } from './components/ImpersonationNotice';
import { ViewAsPicker } from './components/ViewAsPicker';

/**
 * @typedef {object} Tile
 * @property {string} key      Key on the /admin/stats payload.
 * @property {string} label
 * @property {string} hint
 * @property {string} to
 * @property {Function} icon
 * @property {'neutral'|'warning'} [tone]
 */

/** @type {Tile[]} */
const TILES = [
  {
    key: 'total_users',
    label: 'Registered accounts',
    hint: 'Patients, doctors and admins',
    to: PATHS.ADMIN_PATIENTS,
    icon: Users,
  },
  {
    key: 'total_doctors',
    label: 'Doctors',
    hint: 'Every clinician account, approved or not',
    to: PATHS.ADMIN_DOCTORS,
    icon: Stethoscope,
  },
  {
    key: 'total_scans',
    label: 'Scans analysed',
    hint: 'All AI predictions ever run',
    to: PATHS.ADMIN_SCANS,
    icon: ScanLine,
  },
  {
    key: 'pending_doctor_verifications',
    label: 'Awaiting verification',
    hint: 'Doctors who cannot take patients yet',
    to: PATHS.ADMIN_DOCTORS,
    icon: BadgeCheck,
    tone: 'warning',
  },
];

const SHORTCUTS = [
  { label: 'Appointments', to: PATHS.ADMIN_APPOINTMENTS, icon: CalendarDays },
  { label: 'Audit log', to: PATHS.ADMIN_AUDIT_LOG, icon: ScrollText },
  { label: 'Scans', to: PATHS.ADMIN_SCANS, icon: ScanLine },
];

function StatTile({ tile, value, loading }) {
  const Icon = tile.icon;
  const urgent = tile.tone === 'warning' && Number(value) > 0;

  return (
    <Card
      as={Link}
      to={tile.to}
      interactive
      padding="md"
      className={cn(
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        urgent && 'border-warning-300 dark:border-warning-800',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-muted">{tile.label}</p>
          {loading ? (
            <Skeleton shape="rect" width={72} height={36} className="mt-2" />
          ) : (
            <p
              className={cn(
                'mt-1 text-display-sm tabular-nums',
                urgent ? 'text-warning-700 dark:text-warning-300' : 'text-neutral-900 dark:text-neutral-50',
              )}
            >
              {formatNumber(value ?? 0)}
            </p>
          )}
          <p className="mt-1 text-caption text-muted">{tile.hint}</p>
        </div>
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-lg',
            urgent
              ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300'
              : 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
    </Card>
  );
}

export default function AdminOverviewPage() {
  const { user, actingAs } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    // Delegated requests lose the admin permission set, so this call is
    // guaranteed to 403 while impersonating. Do not make it.
    if (actingAs) {
      setLoading(false);
      return undefined;
    }

    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    get(adminEndpoints.stats(), { signal: controller.signal, timeoutMs: 15_000 })
      .then((data) => {
        if (!alive) return;
        setStats(data && typeof data === 'object' ? data : {});
        setLoading(false);
      })
      .catch((err) => {
        if (!alive || err?.name === 'AbortError') return;
        setError(err instanceof ApiError ? err : new ApiError(0, String(err?.message || err)));
        setLoading(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [actingAs, nonce]);

  // Pending verifications lead when there are any: the console's job is to
  // surface the queue that blocks other people, not to be a tidy grid.
  const tiles = [...TILES].sort((a, b) => {
    const aUrgent = a.tone === 'warning' && Number(stats?.[a.key]) > 0 ? -1 : 0;
    const bUrgent = b.tone === 'warning' && Number(stats?.[b.key]) > 0 ? -1 : 0;
    return aUrgent - bUrgent;
  });

  return (
    <AdminPage
      title="Platform overview"
      description={`Signed in as ${user?.name || 'admin'}. Every figure here is re-checked against your permissions on the server.`}
      actions={<ViewAsPicker />}
      banner={<ImpersonationNotice />}
    >
      {error ? (
        <Alert
          tone="danger"
          title="Could not load platform statistics"
          actions={<Button size="sm" variant="outline" onClick={reload}>Try again</Button>}
        >
          {error.message}
        </Alert>
      ) : null}

      {!actingAs ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => (
            <StatTile key={tile.key} tile={tile} value={stats?.[tile.key]} loading={loading} />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="There is no admin doctor or patient dashboard — act as a real one"
            description="Impersonation, not a preview: the action really happens, and the audit log records that you did it."
          />
          <CardBody className="flex flex-col gap-3">
            <p className="text-body-sm text-muted">
              Your account holds every doctor and patient permission, so the workspace switcher used
              to offer you a &ldquo;Doctor workspace&rdquo; and a &ldquo;My skin health&rdquo; of your
              own. Both were empty and always would be: there is no clinic profile behind an admin
              account, so there were no referrals, no schedule, no ratings and no scans to show. Those
              two entries are gone.
            </p>
            <p className="text-body-sm text-muted">
              What replaces them is this. Pick a real doctor or patient and every request carries
              {' '}
              <code className="rounded bg-surface-sunken px-1 py-0.5 text-caption">X-Act-As-User-Id</code>
              {' '}— you see their actual referrals and appointments, and you can act on them. The
              server checks your rank, refuses root accounts, and writes an audit row each time.
            </p>
            <ViewAsPicker />
            <p className="text-caption text-muted">
              For routine jobs you do not need to become anyone: adding an account, editing details,
              resetting a password and taking a booking all live on the pages in the sidebar.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Jump to" />
          <CardBody className="flex flex-col gap-1">
            {SHORTCUTS.map((shortcut) => {
              const Icon = shortcut.icon;
              return (
                <Button
                  key={shortcut.to}
                  as={Link}
                  to={shortcut.to}
                  variant="ghost"
                  className="justify-start"
                  leftIcon={<Icon className="h-4 w-4" aria-hidden="true" />}
                >
                  {shortcut.label}
                </Button>
              );
            })}
          </CardBody>
        </Card>
      </div>
    </AdminPage>
  );
}
