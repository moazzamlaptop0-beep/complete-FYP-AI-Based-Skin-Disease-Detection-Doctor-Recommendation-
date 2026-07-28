/**
 * PageHeader (patient) — a thin wrapper over the shared dashboard PageHeader.
 * The five patient pages keep their import path; the implementation (and the
 * page title scale, which used to differ between surfaces) lives in one place.
 */

import React from 'react';

import SharedPageHeader from '../../../components/dashboard/PageHeader';

export function PageHeader(props) {
  return <SharedPageHeader {...props} />;
}

export default PageHeader;
