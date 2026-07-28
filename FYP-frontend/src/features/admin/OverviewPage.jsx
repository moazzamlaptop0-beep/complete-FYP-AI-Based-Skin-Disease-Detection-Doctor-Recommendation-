/**
 * AdminOverviewPage — the admin console home.
 *
 * `GET /admin/stats` returns exactly four integers. Rather than dress them up
 * with a charting dependency they cannot support, each tile states the number,
 * says what it counts, and links to the page where you can act on it. A stat
 * you cannot act on is decoration.
 *
 * The one tile that is not neutral is the verification queue: pending doctors
 * are people who cannot practise on the platform until an admin looks at them,
 * so it turns warning-toned and jumps to the front of the grid when non-zero.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  CalendarDays,
  ScanLine,
  ScrollText,
  Stethoscope,
  UserRound,
  Users,
} from 'lucide-react';

import { StatCard } from '../../components/dashboard';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
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
 * @property {string} tone     StatCard icon tint.
 * @property {boolean} [urgentWhenNonZero]
 */

/** @type {Tile[]} */
const TILES = [
  {
    key: 'total_users',
    label: 'Registered accounts',
    hint: 'Patients, doctors and admins',
    to: PATHS.ADMIN_PATIENTS,
    icon: Users,
    tone: 'primary',
  },
  {
    key: 'total_doctors',
    label: 'Doctors',
    hint: 'Every clinician account, approved or not',
    to: PATHS.ADMIN_DOCTORS,
    icon: Stethoscope,
    tone: 'accent',
  },
  {
    key: 'total_scans',
    label: 'Scans analysed',
    hint: 'All AI predictions ever run',
    to: PATHS.ADMIN_SCANS,
    icon: ScanLine,
    tone: 'info',
  },
  {
    key: 'pending_doctor_verifications',
    label: 'Awaiting verification',
    hint: 'Doctors who cannot take patients yet',
    to: PATHS.ADMIN_DOCTORS,
    icon: BadgeCheck,
    tone: 'warning',
    urgentWhenNonZero: true,
  },
];

const SHORTCUTS = [
  { label: 'Appointments', to: PATHS.ADMIN_APPOINTMENTS, icon: CalendarDays },
  { label: 'Audit log', to: PATHS.ADMIN_AUDIT_LOG, icon: ScrollText },
  { label: 'Scans', to: PATHS.ADMIN_SCANS, icon: ScanLine },
];

export default function AdminOverviewPage() {
  const { user, actingAs } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  // Loading is derived, not a flag an effect has to keep in sync: nothing has
  // arrived and nothing has failed yet.
  const loading = stats === null && !error;

  const reload = useCallback(() => {
    setStats(null);
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    // Delegated requests lose the admin permission set, so this call is
    // guaranteed to 403 while impersonating. Do not make it. (No state write
    // here: the tiles are not rendered at all while acting as someone.)
    if (actingAs) return undefined;

    let alive = true;
    const controller = new AbortController();

    get(adminEndpoints.stats(), { signal: controller.signal, timeoutMs: 15_000 })
      .then((data) => {
        if (!alive) return;
        setStats(data && typeof data === 'object' ? data : {});
      })
      .catch((err) => {
        if (!alive || err?.name === 'AbortError') return;
        setError(err instanceof ApiError ? err : new ApiError(0, String(err?.message || err)));
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [actingAs, nonce]);

  // Pending verifications lead when there are any: the console's job is to
  // surface the queue that blocks other people, not to be a tidy grid.
  const tiles = [...TILES].sort((a, b) => {
    const aUrgent = a.urgentWhenNonZero && Number(stats?.[a.key]) > 0 ? -1 : 0;
    const bUrgent = b.urgentWhenNonZero && Number(stats?.[b.key]) > 0 ? -1 : 0;
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
        <div className="grid grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
          {tiles.map((tile) => (
            <StatCard
              key={tile.key}
              label={tile.label}
              value={formatNumber(stats?.[tile.key] ?? 0)}
              hint={tile.hint}
              icon={tile.icon}
              tone={tile.tone}
              to={tile.to}
              loading={loading}
              urgent={tile.urgentWhenNonZero && Number(stats?.[tile.key]) > 0}
            />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={(
              <span className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-field bg-primary-100 text-primary-700">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                </span>
                See the platform as a real doctor or patient
              </span>
            )}
            description="Impersonation, not a preview: the action really happens, and the audit log records that you did it."
          />
          <CardBody className="flex flex-col gap-3">
            <p className="text-body-sm text-muted">
              An admin account has no clinic profile of its own, so it has no referrals, schedule,
              ratings or scans to show. To see a real doctor&apos;s or patient&apos;s surface, act as
              one: every request then carries
              {' '}
              <code className="rounded bg-surface-sunken px-1 py-0.5 text-caption">X-Act-As-User-Id</code>
              , the server checks your rank, refuses root accounts, and writes an audit row each time.
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
