/**
 * DoctorPatientsPage — the roster, derived from GET /doctor/scans/<doctor_id>.
 *
 * THERE IS NO "LIST MY PATIENTS" ROUTE
 * ------------------------------------
 * The backend models the relationship the other way round: a scan carries the
 * doctor it was referred to. So the roster is `groupScansByPatient()` over the
 * referral list — one row per `patient_id`, with the newest scan, the worst
 * severity still on file and how many cases are still awaiting review.
 *
 * THE URL IS THE STATE
 * --------------------
 * The pre-refactor dashboard opened a patient by swapping the rendered
 * component while the address bar stayed on the list, which broke Back, broke
 * refresh and made a case impossible to send to a colleague. Every row here is
 * a real <Link> to /doctor/patients/:patientId.
 */

import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, RefreshCw, Users } from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  DataTable,
  EmptyState,
  SearchInput,
  SeverityBadge,
  Select,
} from '../../components/ui';
import { formatDate, formatRelativeTime } from '../../lib/format';
import { doctorPatientPath } from '../../routes';
import PageHeader from './components/PageHeader';
import { groupScansByPatient, severityRank, useDoctorScans } from './hooks/useDoctorData';

const FILTERS = [
  { value: 'all', label: 'All patients' },
  { value: 'pending', label: 'Awaiting my review' },
  { value: 'critical', label: 'Critical or urgent' },
];

export default function DoctorPatientsPage() {
  const navigate = useNavigate();
  const { scans, loading, error, refreshing, refresh } = useDoctorScans();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const patients = useMemo(() => groupScansByPatient(scans), [scans]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return patients
      .filter((patient) => {
        if (filter === 'pending' && !patient.pendingCount) return false;
        if (filter === 'critical' && severityRank(patient.worstSeverity) > 1) return false;
        if (!needle) return true;
        return (
          patient.name.toLowerCase().includes(needle)
          || String(patient.email || '').toLowerCase().includes(needle)
          || String(patient.patientId).includes(needle)
        );
      })
      .sort((a, b) => {
        // Anyone with work outstanding floats to the top, then by severity, then
        // by recency. A roster sorted purely alphabetically hides the urgent.
        if (Boolean(b.pendingCount) !== Boolean(a.pendingCount)) return b.pendingCount ? 1 : -1;
        const bySeverity = severityRank(a.worstSeverity) - severityRank(b.worstSeverity);
        if (bySeverity !== 0) return bySeverity;
        return new Date(b.lastScanAt || 0) - new Date(a.lastScanAt || 0);
      });
  }, [patients, query, filter]);

  const columns = [
    {
      key: 'name',
      header: 'Patient',
      render: (row) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar size="sm" name={row.name} />
          <span className="min-w-0">
            <Link
              to={doctorPatientPath(row.patientId)}
              className="block truncate text-label-lg text-default underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
            >
              {row.name}
            </Link>
            {row.email && <span className="block truncate text-caption text-muted">{row.email}</span>}
          </span>
        </span>
      ),
    },
    {
      key: 'worstSeverity',
      header: 'Highest severity',
      accessor: (row) => severityRank(row.worstSeverity),
      sortable: true,
      render: (row) => <SeverityBadge severity={row.worstSeverity} size="sm" />,
    },
    {
      key: 'scanCount',
      header: 'Cases',
      numeric: true,
      sortable: true,
      render: (row) => (
        <span className="flex items-center justify-end gap-2">
          <span className="font-numeric text-body-sm text-default">{row.scanCount}</span>
          {row.pendingCount > 0 && (
            <Badge tone="warning" size="sm">{row.pendingCount} to review</Badge>
          )}
        </span>
      ),
    },
    {
      key: 'lastScanAt',
      header: 'Last case',
      accessor: (row) => row.lastScanAt || '',
      sortable: true,
      render: (row) => (
        <span className="whitespace-nowrap text-body-sm text-muted" title={formatDate(row.lastScanAt)}>
          {formatRelativeTime(row.lastScanAt)}
        </span>
      ),
    },
    {
      key: 'open',
      header: <span className="ui-sr-only">Open</span>,
      align: 'right',
      hideOnMobile: true,
      render: () => <ChevronRight className="ml-auto h-4 w-4 text-subtle" aria-hidden="true" />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Patients"
        description="Everyone who has sent you a case, newest concern first."
        meta={
          !loading && patients.length ? (
            <Badge tone="neutral" variant="soft">
              {patients.length} patient{patients.length === 1 ? '' : 's'}
            </Badge>
          ) : null
        }
        actions={
          <Button
            variant="outline"
            leftIcon={<RefreshCw aria-hidden="true" />}
            loading={refreshing}
            onClick={() => refresh()}
          >
            Refresh
          </Button>
        }
      />

      {error && (
        <Alert
          tone="danger"
          title="Could not load your patients"
          className="mb-6"
          actions={<Button size="sm" variant="outline" onClick={() => refresh()}>Try again</Button>}
        >
          {error.message || 'The referral list did not load, so the roster cannot be built.'}
        </Alert>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          className="sm:max-w-sm"
          placeholder="Search by name, email or id"
          aria-label="Search patients"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
        />
        <Select
          className="sm:w-56"
          options={FILTERS}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter patients"
        />
      </div>

      {!loading && !error && !patients.length ? (
        <EmptyState
          bordered
          icon={<Users aria-hidden="true" />}
          title="No patients yet"
          description="A patient appears here as soon as they refer a scan to you. Make sure your availability and fees are set so they can find you."
        />
      ) : (
        <DataTable
          caption="Patients who have referred a case to you"
          columns={columns}
          data={visible}
          loading={loading}
          rowKey={(row) => row.patientId}
          onRowClick={(row) => navigate(doctorPatientPath(row.patientId))}
          emptyTitle="No patients match those filters"
          emptyDescription="Clear the search box or switch back to “All patients”."
        />
      )}
    </>
  );
}
