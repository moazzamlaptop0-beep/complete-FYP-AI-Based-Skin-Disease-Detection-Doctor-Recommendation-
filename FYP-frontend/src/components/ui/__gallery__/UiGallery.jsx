import React, { useState } from 'react';
import {
  Alert,
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  CircularProgress,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Pagination,
  Progress,
  Radio,
  RadioGroup,
  RoleBadge,
  SearchInput,
  Select,
  SeverityBadge,
  Skeleton,
  SkeletonCard,
  SkeletonText,
  Spinner,
  StatusBadge,
  Stepper,
  Switch,
  TabList,
  TabPanel,
  TabTrigger,
  Tabs,
  Textarea,
  ToastProvider,
  Tooltip,
  notify,
} from '../index';
import { cn } from '../../../lib/cn';

/* ==========================================================================
   UI GALLERY
   --------------------------------------------------------------------------
   A route-free visual QA surface for the design system. Every primitive, in
   every variant, rendered simultaneously in LIGHT and DARK so a token change
   can be eyeballed in both themes at once.

   NOT wired into App.jsx routing on purpose — App.jsx is frozen until Phase 4.
   To view it, temporarily render <UiGallery /> from main.jsx, or add a route in
   a scratch branch:

       import UiGallery from './components/ui/__gallery__/UiGallery';
       <Route path="/__ui" element={<UiGallery />} />

   The dark half works by scoping `.dark` to a wrapper div rather than <html>,
   which is possible because darkMode is 'class' and every token is a CSS
   variable redefined under `.dark`.
   ========================================================================== */

const ICONS = {
  plus: (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M4 6h12M8 6V4.5h4V6m-6 0 .7 9.5h6.6L15 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  scan: (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
      <path d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3M4 12h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

/** One labelled block in the gallery. */
function Section({ title, description, children, id }) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="mb-4">
        <h2 className="font-heading text-heading-lg text-default">{title}</h2>
        {description && <p className="mt-1 text-body-sm text-muted">{description}</p>}
      </div>
      <div className="rounded-card border border-subtle bg-surface p-5">{children}</div>
    </section>
  );
}

/** A row of examples with a caption underneath. */
function Row({ label, children, className }) {
  return (
    <div className="py-3">
      {label && (
        <p className="mb-2.5 font-body text-label-sm uppercase tracking-[0.08em] text-subtle">
          {label}
        </p>
      )}
      <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>
    </div>
  );
}

const BUTTON_VARIANTS = ['primary', 'secondary', 'outline', 'ghost', 'danger', 'success', 'link'];
const BADGE_TONES = ['neutral', 'primary', 'accent', 'success', 'warning', 'danger'];

/**
 * Swatch classes are written out in full ON PURPOSE. Tailwind scans source as
 * plain text, so a template literal like `bg-${scale}-${step}` produces no CSS
 * at all — the single most common "my colours vanished in prod" bug.
 */
const PALETTE = {
  primary: ['bg-primary-50', 'bg-primary-100', 'bg-primary-200', 'bg-primary-300', 'bg-primary-400', 'bg-primary-500', 'bg-primary-600', 'bg-primary-700', 'bg-primary-800', 'bg-primary-900', 'bg-primary-950'],
  accent: ['bg-accent-50', 'bg-accent-100', 'bg-accent-200', 'bg-accent-300', 'bg-accent-400', 'bg-accent-500', 'bg-accent-600', 'bg-accent-700', 'bg-accent-800', 'bg-accent-900', 'bg-accent-950'],
  success: ['bg-success-50', 'bg-success-100', 'bg-success-200', 'bg-success-300', 'bg-success-400', 'bg-success-500', 'bg-success-600', 'bg-success-700', 'bg-success-800', 'bg-success-900', 'bg-success-950'],
  warning: ['bg-warning-50', 'bg-warning-100', 'bg-warning-200', 'bg-warning-300', 'bg-warning-400', 'bg-warning-500', 'bg-warning-600', 'bg-warning-700', 'bg-warning-800', 'bg-warning-900', 'bg-warning-950'],
  danger: ['bg-danger-50', 'bg-danger-100', 'bg-danger-200', 'bg-danger-300', 'bg-danger-400', 'bg-danger-500', 'bg-danger-600', 'bg-danger-700', 'bg-danger-800', 'bg-danger-900', 'bg-danger-950'],
  neutral: ['bg-neutral-50', 'bg-neutral-100', 'bg-neutral-200', 'bg-neutral-300', 'bg-neutral-400', 'bg-neutral-500', 'bg-neutral-600', 'bg-neutral-700', 'bg-neutral-800', 'bg-neutral-900', 'bg-neutral-950'],
};

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const TABLE_COLUMNS = [
  { key: 'patient', header: 'Patient', sortable: true },
  {
    key: 'severity',
    header: 'Severity',
    render: (row) => <SeverityBadge severity={row.severity} size="sm" />,
    sortable: true,
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <StatusBadge status={row.status} size="sm" />,
  },
  { key: 'confidence', header: 'Confidence', numeric: true, sortable: true, render: (r) => `${r.confidence}%` },
  { key: 'date', header: 'Date', hideOnMobile: true },
];

const TABLE_DATA = [
  { id: 1, patient: 'Ayesha Khan', severity: 'CRITICAL', status: 'pending', confidence: 94, date: '2026-07-21' },
  { id: 2, patient: 'Bilal Ahmed', severity: 'URGENT', status: 'approved', confidence: 81, date: '2026-07-20' },
  { id: 3, patient: 'Sana Malik', severity: 'ROUTINE', status: 'closed', confidence: 67, date: '2026-07-18' },
];

const WIZARD_STEPS = [
  { id: 'photo', label: 'Upload photo', description: 'Clear, well-lit image' },
  { id: 'symptoms', label: 'Symptoms', description: 'Duration and itching' },
  // Guard demo: this step cannot be entered until step 2 is complete.
  { id: 'doctor', label: 'Choose doctor', canEnter: ({ furthest }) => furthest >= 1 },
  { id: 'confirm', label: 'Confirm', optional: true },
];

/** Everything below renders once per theme. */
function GalleryContent() {
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState('urgent');
  const [tab, setTab] = useState('overview');
  const [step, setStep] = useState(1);
  const [page, setPage] = useState(3);
  const [search, setSearch] = useState('');

  return (
    <div className="space-y-10 bg-canvas p-6 text-default">
      {/* ------------------------------------------------ colour tokens -- */}
      <Section title="Palette" description="Every scale is CSS-variable backed and flips with the theme.">
        {Object.entries(PALETTE).map(([scale, classes]) => (
          <div key={scale} className="mb-3 last:mb-0">
            <p className="mb-1.5 font-body text-label-sm uppercase tracking-[0.08em] text-subtle">
              {scale}
            </p>
            <div className="ui-scrollbar flex gap-1 overflow-x-auto">
              {classes.map((swatch, i) => (
                <div key={swatch} className="flex shrink-0 flex-col items-center gap-1">
                  <div className={cn('h-10 w-12 rounded-control border border-subtle', swatch)} />
                  <span className="font-numeric text-[0.625rem] text-subtle">{STEPS[i]}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['canvas', 'bg-canvas'],
            ['surface', 'bg-surface'],
            ['surface-raised', 'bg-surface-raised'],
            ['surface-sunken', 'bg-surface-sunken'],
          ].map(([name, cls]) => (
            <div key={name} className={cn('rounded-control border border-default p-3', cls)}>
              <span className="text-caption text-muted">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------ buttons -- */}
      <Section title="Button" description="7 variants x 4 sizes, loading, icons, polymorphic `as`.">
        <Row label="Variants">
          {BUTTON_VARIANTS.map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
        </Row>
        <Row label="Sizes">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Add">{ICONS.plus}</Button>
        </Row>
        <Row label="With icons">
          <Button leftIcon={ICONS.plus}>New scan</Button>
          <Button variant="outline" rightIcon={ICONS.arrow}>Continue</Button>
          <Button variant="danger" leftIcon={ICONS.trash}>Delete</Button>
        </Row>
        <Row label="States">
          <Button loading>Saving</Button>
          <Button loading loadingText="Uploading…">Upload</Button>
          <Button disabled>Disabled</Button>
          <Button variant="secondary" fullWidth className="max-w-xs">Full width</Button>
        </Row>
        <Row label="Polymorphic + IconButton">
          <Button as="a" href="#gallery-top" variant="link">Rendered as an anchor</Button>
          <IconButton aria-label="Add item" variant="primary">{ICONS.plus}</IconButton>
          <IconButton aria-label="Delete item" variant="danger" size="sm">{ICONS.trash}</IconButton>
          <IconButton aria-label="Next" variant="outline" size="lg">{ICONS.arrow}</IconButton>
        </Row>
      </Section>

      {/* -------------------------------------------------------- forms -- */}
      <Section title="Form controls" description="All wired through Field: id, label, hint, error, aria-describedby, aria-invalid.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name" hint="As it appears on your CNIC" required>
            <Input placeholder="Ayesha Khan" />
          </Field>
          <Field label="Email" error="That email is already registered">
            <Input type="email" defaultValue="demo.patient@aiderma.local" />
          </Field>
          <Field label="Specialisation">
            <Select placeholder="Choose one" options={[
              { value: 'derm', label: 'Dermatology' },
              { value: 'onc', label: 'Oncology' },
              { value: 'gen', label: 'General practice' },
            ]} />
          </Field>
          <Field label="Disabled" disabled hint="Cascades to the control">
            <Input defaultValue="Locked" />
          </Field>
          <Field label="Notes" hint="Visible to the reviewing doctor" className="sm:col-span-2">
            <Textarea maxLength={200} placeholder="Describe the affected area…" />
          </Field>
        </div>

        <Row label="Search">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patients"
            className="max-w-xs"
          />
          <SearchInput loading defaultValue="melanoma" className="max-w-xs" />
        </Row>

        <Row label="Checkbox / Switch">
          <Checkbox label="I consent to storage" description="Required to save your scan" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <Checkbox label="Indeterminate" indeterminate />
          <Checkbox label="Disabled" disabled />
          <Switch label="Email notifications" checked={switchOn} onChange={(e) => setSwitchOn(e.target.checked)} />
          <Switch label="Disabled" disabled />
        </Row>

        <Row label="Radio group" className="block">
          <RadioGroup legend="Triage priority" value={radio} onChange={setRadio} orientation="horizontal">
            <Radio value="routine" label="Routine" />
            <Radio value="urgent" label="Urgent" />
            <Radio value="critical" label="Critical" />
          </RadioGroup>
          <div className="mt-4 max-w-md">
            <RadioGroup
              legend="Card variant"
              variant="card"
              defaultValue="a"
              options={[
                { value: 'a', label: 'In person', description: 'Visit the clinic' },
                { value: 'b', label: 'Video call', description: 'Consult remotely' },
              ]}
            />
          </div>
        </Row>
      </Section>

      {/* ------------------------------------------------------- badges -- */}
      <Section title="Badge" description="Solid / soft / outline across 6 tones, plus the Severity, Status and Role presets.">
        {['solid', 'soft', 'outline'].map((variant) => (
          <Row key={variant} label={variant}>
            {BADGE_TONES.map((tone) => (
              <Badge key={tone} tone={tone} variant={variant}>{tone}</Badge>
            ))}
          </Row>
        ))}
        <Row label="Severity presets">
          <SeverityBadge severity="ROUTINE" />
          <SeverityBadge severity="URGENT" />
          <SeverityBadge severity="CRITICAL" />
          <SeverityBadge severity="MYSTERY" />
        </Row>
        <Row label="Status presets">
          {['pending', 'approved', 'rejected', 'open', 'closed', 'in_progress', 'expired'].map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </Row>
        <Row label="Role presets (literals stay 'Admin' | 'Doctor' | 'AI User')">
          <RoleBadge role="Admin" />
          <RoleBadge role="Doctor" />
          <RoleBadge role="AI User" />
        </Row>
      </Section>

      {/* ------------------------------------------------------ avatars -- */}
      <Section title="Avatar">
        <Row label="Sizes + initials fallback">
          {['xs', 'sm', 'md', 'lg', 'xl', '2xl'].map((s) => (
            <Avatar key={s} size={s} name="Dr. Ayesha Khan" />
          ))}
        </Row>
        <Row label="Status + shape + broken image fallback">
          <Avatar name="Bilal Ahmed" status="online" />
          <Avatar name="Sana Malik" status="busy" />
          <Avatar name="Omar Farooq" status="away" shape="rounded" />
          <Avatar name="Broken URL" src="https://example.invalid/nope.png" />
          <AvatarGroup items={[{ name: 'Ayesha Khan' }, { name: 'Bilal Ahmed' }, { name: 'Sana Malik' }, { name: 'Omar Farooq' }, { name: 'Zara Ali' }, { name: 'Hina Raza' }]} />
        </Row>
      </Section>

      {/* -------------------------------------------------------- cards -- */}
      <Section title="Card">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {['elevated', 'flat', 'outline', 'sunken', 'inverted'].map((variant) => (
            <Card key={variant} variant={variant}>
              <p className="font-body text-label-lg">{variant}</p>
              <p className="mt-1 text-body-sm opacity-80">Card variant preview.</p>
            </Card>
          ))}
          <Card interactive>
            <p className="font-body text-label-lg">interactive</p>
            <p className="mt-1 text-body-sm text-muted">Hover to lift.</p>
          </Card>
        </div>
        <div className="mt-4">
          <Card padding="none">
            <CardHeader title="Composed card" description="Header / body / footer" actions={<Button size="sm" variant="outline">Action</Button>} divider />
            <CardBody>
              <p className="text-body-sm text-muted">Body content sits between the two dividers.</p>
            </CardBody>
            <CardFooter>
              <Button variant="ghost" size="sm">Cancel</Button>
              <Button size="sm">Save</Button>
            </CardFooter>
          </Card>
        </div>
      </Section>

      {/* ------------------------------------------------------- alerts -- */}
      <Section title="Alert">
        <div className="space-y-3">
          <Alert tone="info" title="Verification pending">Your doctor account is awaiting admin approval.</Alert>
          <Alert tone="success" title="Scan saved">The result was added to the patient timeline.</Alert>
          <Alert tone="warning" title="Low image quality">Re-take the photo in better light for a reliable result.</Alert>
          <Alert tone="danger" title="Upload failed" actions={<Button size="sm" variant="danger">Retry</Button>}>
            The file exceeded the 10 MB limit.
          </Alert>
          <Alert tone="neutral" onDismiss={() => {}}>Dismissible neutral message.</Alert>
        </div>
      </Section>

      {/* --------------------------------------------------- feedback --- */}
      <Section title="Spinner, Progress, Skeleton">
        <Row label="Spinner">
          {['xs', 'sm', 'md', 'lg', 'xl'].map((s) => <Spinner key={s} size={s} />)}
        </Row>
        <Row label="Progress" className="block space-y-4">
          <Progress value={35} label="Uploading scan" showValue />
          <Progress value={72} tone="success" size="sm" />
          <Progress indeterminate tone="accent" />
          <Progress value={88} striped tone="warning" size="lg" />
          <div className="flex items-center gap-4">
            <CircularProgress value={25} showValue />
            <CircularProgress value={66} tone="success" showValue />
            <CircularProgress value={92} tone="danger" size={64} thickness={6} showValue />
          </div>
        </Row>
        <Row label="Skeleton" className="block">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Skeleton shape="text" width="70%" />
              <SkeletonText lines={3} />
              <Skeleton shape="rect" height={40} animation="sweep" />
            </div>
            <SkeletonCard />
          </div>
        </Row>
      </Section>

      {/* -------------------------------------------------------- tabs -- */}
      <Section title="Tabs" description="Arrow keys move, Home/End jump, roving tabindex, wraps.">
        <Tabs value={tab} onValueChange={setTab}>
          <TabList aria-label="Gallery tabs" actions={<Button size="sm" variant="ghost">Filter</Button>}>
            <TabTrigger value="overview">Overview</TabTrigger>
            <TabTrigger value="scans" badge={<Badge size="sm" tone="primary">12</Badge>}>Scans</TabTrigger>
            <TabTrigger value="notes">Notes</TabTrigger>
            <TabTrigger value="locked" disabled>Locked</TabTrigger>
          </TabList>
          <TabPanel value="overview"><p className="text-body-sm text-muted">Overview panel.</p></TabPanel>
          <TabPanel value="scans"><p className="text-body-sm text-muted">Scans panel.</p></TabPanel>
          <TabPanel value="notes"><p className="text-body-sm text-muted">Notes panel.</p></TabPanel>
          <TabPanel value="locked"><p className="text-body-sm text-muted">Never reachable.</p></TabPanel>
        </Tabs>

        <div className="mt-6">
          <Tabs defaultValue="a" variant="pill">
            <TabList>
              <TabTrigger value="a">Pill</TabTrigger>
              <TabTrigger value="b">Variant</TabTrigger>
            </TabList>
            <TabPanel value="a"><p className="text-body-sm text-muted">Pill A</p></TabPanel>
            <TabPanel value="b"><p className="text-body-sm text-muted">Pill B</p></TabPanel>
          </Tabs>
        </div>
      </Section>

      {/* ----------------------------------------------------- stepper -- */}
      <Section title="Stepper" description="Step 3 declares canEnter and stays locked until step 2 is reached.">
        <Stepper steps={WIZARD_STEPS} current={step} furthest={step} onStepChange={setStep} />
        <div className="mt-6 flex gap-3">
          <Button variant="outline" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>
          <Button size="sm" onClick={() => setStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1))}>Next</Button>
        </div>
        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          <Stepper steps={WIZARD_STEPS.slice(0, 3)} current={1} orientation="vertical" />
          <div>
            <Stepper steps={WIZARD_STEPS} current={2} variant="dots" />
            <p className="mt-3 text-center text-caption text-subtle">dots variant</p>
          </div>
        </div>
      </Section>

      {/* --------------------------------------------------- datatable -- */}
      <Section title="DataTable" description="Resize below 768px: the table collapses into label/value cards.">
        <DataTable
          columns={TABLE_COLUMNS}
          data={TABLE_DATA}
          caption="Recent scans"
          zebra
          onRowClick={() => {}}
          pagination={{ page, total: 84, pageSize: 10, onPageChange: setPage }}
        />
        <div className="mt-6">
          <p className="mb-2 font-body text-label-sm uppercase tracking-[0.08em] text-subtle">Loading</p>
          <DataTable columns={TABLE_COLUMNS} data={[]} loading />
        </div>
        <div className="mt-6">
          <p className="mb-2 font-body text-label-sm uppercase tracking-[0.08em] text-subtle">Empty</p>
          <DataTable columns={TABLE_COLUMNS} data={[]} emptyTitle="No scans yet" emptyDescription="Upload a photo to get your first analysis." />
        </div>
      </Section>

      {/* -------------------------------------------------- pagination -- */}
      <Section title="Pagination">
        <div className="space-y-5">
          <Pagination page={page} total={84} pageSize={10} onPageChange={setPage} onPageSizeChange={() => {}} />
          <Pagination page={1} pageCount={3} onPageChange={() => {}} showSummary={false} />
          <Pagination page={5} pageCount={9} onPageChange={() => {}} compact showSummary={false} />
        </div>
      </Section>

      {/* -------------------------------------------------- empty state -- */}
      <Section title="EmptyState">
        <div className="grid gap-4 lg:grid-cols-2">
          <EmptyState icon={ICONS.scan} title="No scans yet" description="Upload a photo to get your first AI analysis." action={<Button leftIcon={ICONS.plus}>New scan</Button>} bordered />
          <EmptyState icon={ICONS.scan} tone="danger" title="Could not load history" description="The server did not respond." action={<Button variant="outline">Retry</Button>} secondaryAction={<Button variant="ghost">Contact support</Button>} />
        </div>
      </Section>

      {/* ----------------------------------------------------- overlays -- */}
      <Section title="Overlays" description="One shared portal, one focus trap, reference-counted scroll lock.">
        <Row label="Triggers">
          <Button onClick={() => setModalOpen(true)}>Open Modal</Button>
          <Button variant="outline" onClick={() => setDrawerOpen(true)}>Open Drawer</Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>Delete scan…</Button>
        </Row>
        <Row label="Tooltip (hover or Tab to it, Esc dismisses)">
          <Tooltip content="Appears on hover AND keyboard focus">
            <Button variant="outline">Top</Button>
          </Tooltip>
          <Tooltip content="Flips when it would overflow" placement="right">
            <Button variant="outline">Right</Button>
          </Tooltip>
          <Tooltip content="Supplements the name — never replaces it">
            <IconButton aria-label="Help">{ICONS.plus}</IconButton>
          </Tooltip>
        </Row>
        <Row label="Toast">
          <Button size="sm" variant="success" onClick={() => notify.success('Scan uploaded')}>Success</Button>
          <Button size="sm" variant="danger" onClick={() => notify.error('Upload failed')}>Error</Button>
          <Button size="sm" variant="outline" onClick={() => notify.warning('Low image quality')}>Warning</Button>
          <Button size="sm" variant="ghost" onClick={() => notify.info('Analysis queued')}>Info</Button>
        </Row>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Reschedule appointment"
          description="The patient is notified automatically."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button onClick={() => setModalOpen(false)}>Confirm</Button>
            </>
          }
        >
          <div className="space-y-4 py-2">
            <Field label="New date"><Input type="date" /></Field>
            <Field label="Reason" hint="Shown to the patient"><Textarea rows={3} /></Field>
            <p className="text-body-sm text-muted">Tab through — focus is trapped, Esc closes, and focus returns to the trigger.</p>
          </div>
        </Modal>

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Filters"
          description="Narrow the scan queue"
          footer={<Button fullWidth onClick={() => setDrawerOpen(false)}>Apply</Button>}
        >
          <div className="space-y-5">
            <RadioGroup legend="Severity" defaultValue="all" options={[
              { value: 'all', label: 'All' },
              { value: 'urgent', label: 'Urgent and above' },
              { value: 'critical', label: 'Critical only' },
            ]} />
            <Checkbox label="Unreviewed only" />
          </div>
        </Drawer>

        <ConfirmDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => new Promise((r) => setTimeout(r, 900))}
          title="Delete this scan?"
          description="This permanently removes the image and its analysis. This cannot be undone."
          confirmLabel="Delete"
        />
      </Section>
    </div>
  );
}

/**
 * Route-free preview of the entire design system, rendered once in light and
 * once in dark. Not referenced by App.jsx.
 */
export function UiGallery() {
  const [split, setSplit] = useState(true);

  return (
    <div id="gallery-top" className="min-h-screen bg-canvas">
      <ToastProvider />

      <header className="sticky top-0 z-sticky border-b border-subtle bg-surface/90 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-heading-lg text-default">UI Gallery</h1>
            <p className="text-caption text-muted">
              Design-system QA surface — not wired into routing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="accent" variant="soft">Phase 2B-1</Badge>
            <Button size="sm" variant="outline" onClick={() => setSplit((s) => !s)}>
              {split ? 'Single theme' : 'Both themes'}
            </Button>
          </div>
        </div>
      </header>

      <div className={cn(split && 'grid grid-cols-1 xl:grid-cols-2')}>
        {/* LIGHT */}
        <div className="border-subtle xl:border-r">
          <p className="border-b border-subtle bg-surface-sunken px-6 py-2 font-body text-label-sm uppercase tracking-[0.1em] text-subtle">
            Light
          </p>
          <GalleryContent />
        </div>

        {/* DARK — `.dark` scoped to this wrapper, which works because darkMode
            is 'class' and every token is redefined under `.dark`. */}
        {split && (
          <div className="dark">
            <p className="border-b border-subtle bg-surface-sunken px-6 py-2 font-body text-label-sm uppercase tracking-[0.1em] text-subtle">
              Dark
            </p>
            <GalleryContent />
          </div>
        )}
      </div>
    </div>
  );
}

export default UiGallery;
