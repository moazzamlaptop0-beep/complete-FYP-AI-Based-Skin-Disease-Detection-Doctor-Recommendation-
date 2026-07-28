/**
 * The two destructive account actions, and the reasons they look different.
 *
 * RESET PASSWORD is recoverable but not quiet: it ends every session the person
 * holds, on every device. That is the point — an admin resetting a password
 * because an account is compromised has to actually evict whoever is in it — so
 * the dialog states it as a consequence rather than burying it, and the generated
 * password is revealed exactly once because only its hash is stored.
 *
 * DELETE is not recoverable, and the server will usually refuse it. Every FK
 * pointing at `users.id` from a clinical table is ON DELETE CASCADE, so deleting
 * an account with history would take third parties' records with it — the
 * appointments this doctor's patients booked, the reviews they wrote. The backend
 * counts those links first and answers 400 with the counts under `data`; this
 * dialog renders them and sends the admin to Suspend, which is the answer for a
 * real person.
 *
 * BOTH REFUSE SOME TARGETS BEFORE THE CLICK. Root accounts, your own account and
 * anyone at or above your own role are all server-side refusals, so
 * `accountActionLock()` (./accountLocks.js) reproduces them and the control
 * arrives disabled with the reason attached. A button that always fails is worse
 * than no button.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, KeyRound, ShieldOff, Trash2 } from 'lucide-react';

import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  ModalFooter,
  notify,
} from '../../../components/ui';
import { del, post } from '../../../lib/api';
import { admin as adminEndpoints } from '../../../lib/endpoints';

import { TemporaryPasswordPanel } from './AccountFormModal';

/**
 * @param {object} props
 * @param {object|null} props.row
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export function ResetPasswordDialog({ row, open, onClose }) {
  const [generate, setGenerate] = useState(true);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reveal, setReveal] = useState(null);

  useEffect(() => {
    setGenerate(true);
    setPassword('');
    setError(null);
    setReveal(null);
  }, [row?.id, open]);

  if (!row) return null;

  const submit = async () => {
    if (!generate) {
      if (!password) {
        setError('Type a password or switch back to generating one.');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (/^\d+$/.test(password)) {
        setError('Password cannot be all numbers.');
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      // Omitting `new_password` is the signal to generate one; sending '' would
      // fail the policy instead.
      const result = await post(
        adminEndpoints.resetUserPassword(row.id),
        generate ? {} : { new_password: password },
      );
      const revoked = Number(result?.sessions_revoked ?? 0);
      notify.success(
        revoked > 0
          ? `Password reset. ${revoked} session${revoked === 1 ? '' : 's'} ended.`
          : 'Password reset.',
      );

      if (result?.temporary_password) {
        setReveal({ password: result.temporary_password, email: result.email });
        return; // stay open — this is the only chance to read it
      }
      onClose();
    } catch (err) {
      setError(err?.message || 'The password could not be reset.');
    } finally {
      setBusy(false);
    }
  };

  if (reveal) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="md"
        title="Password reset"
        description={row.name || reveal.email}
      >
        <TemporaryPasswordPanel
          password={reveal.password}
          email={reveal.email}
          onDone={onClose}
          title="New temporary password"
        />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={`Reset the password for ${row.name || 'this account'}?`}
      description={row.email}
      footer={
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="danger"
            onClick={submit}
            loading={busy}
            leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
          >
            Reset password
          </Button>
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="danger" title="Could not reset">{error}</Alert> : null}

        <Alert tone="warning" title="They will be signed out everywhere">
          Every device they are logged in on stops working immediately. Their scans, appointments and
          reports are untouched. This only changes how they get in.
        </Alert>

        <Checkbox
          checked={generate}
          onChange={(event) => setGenerate(event.target.checked)}
          label="Generate a temporary password"
          description="Shown once here, and emailed to them."
        />

        {!generate ? (
          <Field
            label="New password"
            required
            hint="At least 8 characters, not all numbers, and not a commonly used password."
          >
            <Input
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              className="font-mono"
            />
          </Field>
        ) : null}

        <p className="text-caption text-muted">
          This does not mark their email verified: receiving a code proves an inbox, and nothing
          here does. Written to the audit log against your account.
        </p>
      </div>
    </Modal>
  );
}

/**
 * The refusal counts, in the order an admin reads them.
 *
 * Keys match `account_links()` in app/services/admin_service.py. A key the server
 * adds later and this list does not know about is simply not rendered — the
 * sentence above the list still says the delete was refused, so the failure mode
 * is a less specific explanation rather than a wrong one.
 */
const LINK_LABELS = [
  ['scans', 'scans'],
  ['appointments_as_patient', 'appointments as a patient'],
  ['appointments_as_doctor', 'appointments as the doctor'],
  ['requests_sent', 'consultation requests sent'],
  ['requests_received', 'consultation requests received'],
  ['reviews_written', 'reviews written'],
  ['reviews_received', 'reviews received'],
];

/**
 * @param {object} props
 * @param {object|null} props.row
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(id: number) => void} props.onDeleted
 * @param {() => void} [props.onSuspendInstead] Opens the suspend sheet for this row.
 */
export function DeleteAccountDialog({ row, open, onClose, onDeleted, onSuspendInstead }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /** The 400 payload when the server refuses: `{scans, appointments_*, ...}`. */
  const [links, setLinks] = useState(null);

  useEffect(() => {
    setTyped('');
    setError(null);
    setLinks(null);
  }, [row?.id, open]);

  if (!row) return null;

  const armed = typed.trim().toUpperCase() === 'DELETE';

  const submit = async () => {
    if (!armed) return;
    setBusy(true);
    setError(null);
    setLinks(null);
    try {
      await del(adminEndpoints.deleteUser(row.id));
      notify.success(`${row.name || 'Account'} deleted.`);
      onDeleted?.(row.id);
      onClose();
    } catch (err) {
      setError(err?.message || 'The account could not be deleted.');
      // A blocked delete carries the counts. Render them rather than only the
      // sentence — "3 appointments and 2 reviews" is a decision, "linked
      // records" is a shrug.
      const payload = err?.data;
      if (payload && typeof payload === 'object') {
        const counted = LINK_LABELS
          .map(([key, label]) => [label, Number(payload[key] || 0)])
          .filter(([, count]) => count > 0);
        if (counted.length) setLinks(counted);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Delete this account"
      description={`${row.name || 'This account'} (${row.email})`}
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
        <Alert
          tone="danger"
          title="This cannot be undone"
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        >
          Use it only for a duplicate or test signup. To stop a real person using the platform,
          <strong> suspend them instead</strong>: that keeps every scan, appointment and doctor&apos;s
          note exactly where it is.
        </Alert>

        {links ? (
          <Alert
            tone="warning"
            title="The server refused: this account has history"
            actions={onSuspendInstead ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { onClose(); onSuspendInstead(); }}
                leftIcon={<ShieldOff className="h-4 w-4" aria-hidden="true" />}
              >
                Suspend instead
              </Button>
            ) : undefined}
          >
            <ul className="list-disc space-y-0.5 pl-4">
              {links.map(([label, count]) => (
                <li key={label}>
                  <span className="tabular-nums font-medium">{count}</span> {label}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Deleting would cascade through all of it, including records that belong to other
              people. Nothing has been changed.
            </p>
          </Alert>
        ) : null}

        <Field
          label="Type DELETE to confirm"
          error={!links && error ? error : undefined}
        >
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            placeholder="DELETE"
          />
        </Field>
      </div>
    </Modal>
  );
}

export default ResetPasswordDialog;
