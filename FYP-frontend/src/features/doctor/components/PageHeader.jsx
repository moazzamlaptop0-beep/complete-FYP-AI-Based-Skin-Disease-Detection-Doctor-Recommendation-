/**
 * PageHeader (doctor) — the shared dashboard PageHeader plus the doctor-only
 * WorkspaceChip. The implementation lives in components/dashboard/PageHeader;
 * this wrapper exists so the eight doctor pages keep their import path and
 * their `chip` prop while the three surfaces share one heading block.
 */

import React from 'react';

import SharedPageHeader from '../../../components/dashboard/PageHeader';
import WorkspaceChip from './WorkspaceChip';

/**
 * @param {object} props
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.description]
 * @param {React.ReactNode} [props.actions]
 * @param {React.ReactNode} [props.meta]
 * @param {boolean} [props.chip=true] Render the workspace chip.
 * @param {string} [props.className]
 */
export default function PageHeader({ chip = true, ...rest }) {
  return (
    <SharedPageHeader
      topSlot={chip ? <WorkspaceChip className="self-start" /> : null}
      {...rest}
    />
  );
}

export { PageHeader };
