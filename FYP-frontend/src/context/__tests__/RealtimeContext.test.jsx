/**
 * RealtimeContext — one EventSource, ticket first.
 *
 * Today DoctorDashboard and PatientHistory each open their own unauthenticated
 * EventSource on mount, and every one of those pins a Flask worker that polls
 * the DB every 5 seconds. These tests pin the replacement contract.
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RealtimeProvider, defaultStreamFor, useRealtime } from '../RealtimeContext';
import { configureApi, resetApiState } from '../../lib/api';
import { envelope, jsonResponse } from '../../test/helpers';

/** Minimal EventSource stand-in — jsdom has none. */
class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    FakeEventSource.instances.push(this);
  }

  close() { this.closed = true; }

  emitOpen() { this.onopen?.({}); }

  emitMessage(payload) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

function Probe() {
  const realtime = useRealtime();
  return (
    <div>
      <span data-testid="status">{realtime.status}</span>
      <span data-testid="scans">{realtime.data?.scans?.length ?? '-'}</span>
    </div>
  );
}

beforeEach(() => {
  resetApiState();
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource;
});

afterEach(() => {
  delete globalThis.EventSource;
});

describe('defaultStreamFor', () => {
  it('sends a reviewer to the doctor stream and everyone else to the patient stream', () => {
    expect(defaultStreamFor({ id: 5 }, ['scan.review.assigned'])).toEqual({ kind: 'doctor', id: 5 });
    expect(defaultStreamFor({ id: 5 }, ['scan.read.own'])).toEqual({ kind: 'patient', id: 5 });
    expect(defaultStreamFor(null, [])).toBeNull();
  });
});

describe('connection', () => {
  it('mints a ticket, then opens exactly ONE stream carrying it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope({ ticket: 'tkt-123', expires_in: 60, user_id: 5 })));
    configureApi({ fetchImpl });

    render(
      <RealtimeProvider stream={{ kind: 'doctor', id: 5 }}>
        <Probe />
      </RealtimeProvider>,
    );

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const source = FakeEventSource.instances[0];
    expect(source.url).toContain('/api/doctor-updates-stream/5');
    expect(source.url).toContain('ticket=tkt-123');
    // The ticket route was called BEFORE the stream was opened.
    expect(fetchImpl.mock.calls[0][0]).toContain('/api/stream-ticket');
  });

  it('still connects when the ticket call fails — legacy unauthenticated mode', async () => {
    configureApi({ fetchImpl: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });

    render(
      <RealtimeProvider stream={{ kind: 'patient', id: 9 }}>
        <Probe />
      </RealtimeProvider>,
    );

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0].url).toContain('/api/patient-updates-stream/9');
    expect(FakeEventSource.instances[0].url).not.toContain('ticket=');
  });

  it('parses payloads and survives a malformed frame', async () => {
    configureApi({ fetchImpl: vi.fn(async () => jsonResponse(envelope({ ticket: 't', expires_in: 60 }))) });

    render(
      <RealtimeProvider stream={{ kind: 'doctor', id: 5 }}>
        <Probe />
      </RealtimeProvider>,
    );

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    await act(async () => {
      source.emitOpen();
      source.emitMessage({ scans: [{ id: 1 }, { id: 2 }], appointments: [] });
    });

    expect(screen.getByTestId('status')).toHaveTextContent('open');
    expect(screen.getByTestId('scans')).toHaveTextContent('2');

    // A truncated frame must not kill the stream or blank the last good payload.
    await act(async () => { source.onmessage({ data: '{"scans": [' }); });
    expect(screen.getByTestId('scans')).toHaveTextContent('2');
  });

  it('closes the stream on unmount — no orphaned worker', async () => {
    configureApi({ fetchImpl: vi.fn(async () => jsonResponse(envelope({ ticket: 't' }))) });

    const view = render(
      <RealtimeProvider stream={{ kind: 'doctor', id: 5 }}>
        <Probe />
      </RealtimeProvider>,
    );

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    view.unmount();

    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
