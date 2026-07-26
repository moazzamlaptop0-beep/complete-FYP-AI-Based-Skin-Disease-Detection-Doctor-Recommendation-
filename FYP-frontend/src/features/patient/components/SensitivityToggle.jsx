/**
 * SensitivityToggle — mark a scan's photograph as sensitive.
 *
 * Flipping this changes which BYTES the server sends to everybody who is not
 * the owner: `/api/scans/<id>/image` starts answering with the separately
 * rendered blur, `variant=thumb` is upgraded to blur for those viewers, and only
 * an explicit `variant=full` gets through — which is written to
 * `image_access_log` with the viewer's name.
 *
 * So this is a real access-control change, not a display preference, and it is
 * worth one round trip and one confirmation each way rather than an optimistic
 * flip that silently fails. `reason` is optional here because the backend
 * accepts it as optional; when given it is stored on the scan and shows in the
 * access log's context.
 */

import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Alert, Button, Field, Input, Switch, notify } from '../../../components/ui';
import { patch } from '../../../lib/api';
import { scans as scanEndpoints } from '../../../lib/endpoints';

export function SensitivityToggle({ scan, onChanged, className }) {
  const isSensitive = Boolean(scan?.is_sensitive);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [showReason, setShowReason] = useState(false);

  const apply = async (next, withReason) => {
    setPending(true);
    setError(null);
    try {
      await patch(scanEndpoints.sensitivity(scan.id), {
        is_sensitive: next,
        reason: (withReason || '').trim() || null,
      });
      notify.success(next ? 'Marked as sensitive. Others now see a blurred preview.' : 'Sensitivity removed.');
      setShowReason(false);
      setReason('');
      onChanged?.();
    } catch (err) {
      setError(err?.message || 'We could not change the sensitivity of this photo.');
    } finally {
      setPending(false);
    }
  };

  if (!scan) return null;

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3 rounded-card border border-subtle bg-surface-sunken p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-body text-label-md text-default">
            {isSensitive
              ? <EyeOff className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              : <Eye className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
            Sensitive photograph
          </p>
          <p className="mt-1 font-body text-body-sm text-muted">
            {isSensitive
              ? 'Doctors and admins see a blurred preview. Viewing the full image is recorded against their name.'
              : 'Anyone reviewing this case sees the photo directly.'}
          </p>
        </div>

        <Switch
          checked={isSensitive}
          disabled={pending || Boolean(scan.image_deleted_at)}
          aria-label="Mark this photograph as sensitive"
          onChange={(event) => {
            const next = event?.target ? event.target.checked : Boolean(event);
            // Turning protection ON is where a reason is worth capturing;
            // turning it off is a one-click reversal of your own choice.
            if (next) setShowReason(true); else apply(false, '');
          }}
        />
      </div>

      {showReason && (
        <div className="mt-3 flex flex-col gap-3 rounded-card border border-subtle bg-surface p-3">
          <Field label="Reason (optional)" hint="Stored with the flag so the change can be explained later.">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. the photo shows an intimate area"
              maxLength={200}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowReason(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" loading={pending} onClick={() => apply(true, reason)}>
              Mark as sensitive
            </Button>
          </div>
        </div>
      )}

      {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
    </div>
  );
}

export default SensitivityToggle;
