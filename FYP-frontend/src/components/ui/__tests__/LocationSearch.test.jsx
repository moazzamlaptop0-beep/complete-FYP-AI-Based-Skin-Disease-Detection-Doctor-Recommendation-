/**
 * LocationSearch — the design system's first combobox, so its keyboard contract
 * has nothing to inherit and everything to pin.
 *
 * The two things these tests care most about:
 *  1. The WAI-ARIA combobox wiring is real, not decorative: aria-expanded,
 *     aria-controls, aria-activedescendant and aria-selected all track the
 *     highlighted row, and Down/Up/Enter/Escape/Tab do what APG says.
 *  2. The field can NEVER trap a user. No results, a dead network and a place
 *     that simply is not in OpenStreetMap all end with the typed text intact and
 *     reported to the caller, because this control sits on a signup form where
 *     the location is optional.
 */

import React, { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearGeocodeCache, formatPlaceLabel } from '../../../lib/geocode';
import { jsonResponse } from '../../../test/helpers';

import LocationSearch from '../LocationSearch';

const ISLAMABAD = {
  place_id: 298711635,
  lat: '33.6001033',
  lon: '73.0442278',
  display_name: 'Islamabad, Islamabad Capital Territory, 44000, Pakistan',
  address: { city: 'Islamabad', state: 'Islamabad Capital Territory', country: 'Pakistan' },
};

const LAHORE = {
  place_id: 259240712,
  lat: '31.5656822',
  lon: '74.3141829',
  display_name: 'Lahore, Punjab, Pakistan',
  address: { city: 'Lahore', state: 'Punjab', country: 'Pakistan' },
};

/** Long enough that userEvent's keystrokes can never outrun it. */
const DEBOUNCE = 200;

/**
 * Wired exactly the way DoctorFields wires it: the committed place is state, and
 * raw keystrokes are echoed back through `value.label` as a free-text city. That
 * echo is the loop this component has to survive without eating characters.
 */
function Harness({ onCommit, ...props }) {
  const [place, setPlace] = useState(null);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <LocationSearch
        label="Clinic location"
        debounce={DEBOUNCE}
        value={place}
        onChange={(next) => {
          setPlace(next);
          onCommit?.(next);
        }}
        onTextChange={(text) => setPlace(
          text
            ? { label: text, city: text, state: '', country: '', latitude: null, longitude: null }
            : null,
        )}
        {...props}
      />
      <button type="button">Next field</button>
    </form>
  );
}

function combobox() {
  return screen.getByRole('combobox', { name: 'Clinic location' });
}

/**
 * Type a query and wait for the popup to actually carry results. The popup only
 * appears once the debounced lookup has answered, so waiting on the listbox
 * alone would race the options into existence.
 */
async function openWith(user, query = 'islam') {
  const input = combobox();
  await user.click(input);
  await user.type(input, query);
  const listbox = await screen.findByRole('listbox');
  await waitFor(() => {
    expect(within(listbox).getAllByRole('option').length).toBeGreaterThan(0);
  });
  return { input, listbox };
}

beforeEach(() => {
  clearGeocodeCache();
  globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([ISLAMABAD, LAHORE]));
});

describe('ARIA wiring', () => {
  it('is a combobox with a collapsed popup before anything is typed', () => {
    render(<Harness />);
    const input = combobox();

    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input.getAttribute('aria-controls')).toBeTruthy();
    expect(input).not.toHaveAttribute('aria-activedescendant');
    // Browser autofill must not race our own popup.
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('points aria-controls at the listbox it actually opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const { input, listbox } = await openWith(user);

    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(within(listbox).getAllByRole('option')).toHaveLength(2);
  });

  it('announces the settled result count to a screen reader', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openWith(user);

    expect(await screen.findByText(/2 places found/i)).toBeInTheDocument();
  });

  it('credits OpenStreetMap alongside the results', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openWith(user);

    expect(screen.getByText(/OpenStreetMap/)).toBeInTheDocument();
  });
});

describe('keyboard', () => {
  it('ArrowDown moves the highlight, wraps, and keeps aria-activedescendant in step', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const { input, listbox } = await openWith(user);
    const ids = within(listbox).getAllByRole('option').map((option) => option.id);

    // Nothing is highlighted until the user asks for it.
    expect(input).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', ids[0]);
    expect(within(listbox).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(within(listbox).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', ids[1]);

    // Wraps back to the top rather than dead-ending.
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', ids[0]);
  });

  it('ArrowUp from the top wraps to the last option', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const { input, listbox } = await openWith(user);
    const ids = within(listbox).getAllByRole('option').map((option) => option.id);

    await user.keyboard('{ArrowDown}{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', ids[1]);
  });

  it('Home and End jump to the ends of the list', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const { input, listbox } = await openWith(user);
    const ids = within(listbox).getAllByRole('option').map((option) => option.id);

    await user.keyboard('{ArrowDown}{End}');
    expect(input).toHaveAttribute('aria-activedescendant', ids[1]);
    await user.keyboard('{Home}');
    expect(input).toHaveAttribute('aria-activedescendant', ids[0]);
  });

  it('ArrowDown reopens a closed list without a second request', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const { input } = await openWith(user);
    const requests = globalThis.fetch.mock.calls.length;

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(globalThis.fetch.mock.calls).toHaveLength(requests);
  });

  it('Enter commits the highlighted place with the whole normalised shape', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    const { input } = await openWith(user);

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      label: 'Lahore, Punjab, Pakistan',
      city: 'Lahore',
      state: 'Punjab',
      country: 'Pakistan',
      latitude: 31.5656822,
      longitude: 74.3141829,
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue('Lahore, Punjab, Pakistan');
    expect(input).toHaveFocus();
  });

  it('Enter with nothing highlighted closes the list instead of guessing', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    const { input } = await openWith(user);

    await user.keyboard('{Enter}');

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('islam');
  });

  it('Enter on a CLOSED combobox is left to the form, so submit still works', async () => {
    const onSubmit = vi.fn((event) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <LocationSearch label="Clinic location" value={null} onChange={() => {}} debounce={DEBOUNCE} />
        <button type="submit">Create account</button>
      </form>,
    );

    await user.type(combobox(), 'Chak Jhumra{Enter}');

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the list, then a second Escape clears the field', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    const { input } = await openWith(user);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('islam');

    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(onCommit).toHaveBeenLastCalledWith(null);
  });

  it('Tab commits the highlighted place and then lets focus leave', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    const { input } = await openWith(user);

    await user.keyboard('{ArrowDown}');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ city: 'Islamabad' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).not.toHaveFocus();
  });
});

describe('pointer and touch', () => {
  it('clicking a row commits it and leaves focus in the input', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    const { input, listbox } = await openWith(user);

    await user.click(within(listbox).getAllByRole('option')[0]);

    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({
      city: 'Islamabad',
      state: 'Islamabad Capital Territory',
      country: 'Pakistan',
    }));
    expect(input).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('a pointer landing outside closes the list', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openWith(user);

    await user.click(screen.getByRole('button', { name: 'Next field' }));

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('the clear button empties the field and reports the clear', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);
    const { input, listbox } = await openWith(user);
    await user.click(within(listbox).getAllByRole('option')[0]);

    await user.click(screen.getByRole('button', { name: 'Clear location' }));

    expect(input).toHaveValue('');
    expect(onCommit).toHaveBeenLastCalledWith(null);
    expect(input).toHaveFocus();
  });
});

describe('it never blocks the user', () => {
  it('reports every keystroke, so a place OpenStreetMap has never heard of is still saved', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([]));
    const onTextChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LocationSearch
        label="Clinic location"
        value={null}
        onChange={() => {}}
        onTextChange={onTextChange}
        debounce={DEBOUNCE}
      />,
    );

    await user.type(combobox(), 'Chak Jhumra');

    expect(onTextChange).toHaveBeenLastCalledWith('Chak Jhumra');
    expect(combobox()).toHaveValue('Chak Jhumra');
  });

  it('says so, in the popup, when nothing matches', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([]));
    const user = userEvent.setup();
    render(<Harness />);
    const input = combobox();
    await user.type(input, 'zzzzzz');

    expect(await screen.findByText(/no places match that search/i)).toBeInTheDocument();
    expect(await screen.findByText(/no matching places/i)).toBeInTheDocument();
    expect(within(screen.getByRole('listbox')).queryAllByRole('option')).toHaveLength(0);
    expect(input).toHaveValue('zzzzzz');
  });

  it('offers manual entry, not an error, when the lookup fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<Harness />);
    const input = combobox();
    await user.type(input, 'islamabad');

    expect(await screen.findByText(/location search is unavailable right now/i)).toBeInTheDocument();
    // A failure is not a validation error and must not paint the field red.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('islamabad');
  });

  it('"Try again" re-runs the lookup once the network is back', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(combobox(), 'islamabad');
    await screen.findByRole('button', { name: /try again/i });

    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([ISLAMABAD]));
    await user.click(screen.getByRole('button', { name: /try again/i }));

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(1);
  });

  it('never asks the network about a one or two letter query', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(combobox(), 'is');
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE + 60));

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('coalesces a burst of keystrokes into a single request', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openWith(user, 'islamab');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('as a controlled field', () => {
  it('takes the text from an external value, which is how the map pin fills it in', () => {
    function Controlled({ value }) {
      return <LocationSearch label="Clinic location" value={value} onChange={() => {}} />;
    }

    const { rerender } = render(<Controlled value={null} />);
    expect(combobox()).toHaveValue('');

    // The map was tapped, reverse geocoded, and the answer came back up.
    rerender(<Controlled value={{
      label: 'Islamabad, Islamabad Capital Territory, Pakistan',
      city: 'Islamabad',
      state: 'Islamabad Capital Territory',
      country: 'Pakistan',
      latitude: 33.6,
      longitude: 73.04,
    }} />);

    expect(combobox()).toHaveValue('Islamabad, Islamabad Capital Territory, Pakistan');
  });

  it('renders the label, hint and error through the shared Field plumbing', () => {
    render(
      <LocationSearch
        label="Clinic location"
        hint="Pick your city."
        error="We could not save that city."
        value={null}
        onChange={() => {}}
      />,
    );

    const input = combobox();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('We could not save that city.');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('is inert when disabled', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    const input = combobox();

    expect(input).toBeDisabled();
    await user.type(input, 'islam');

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

/**
 * The registration form does NOT store a label: it stores city, state, country
 * and coordinates, and derives the label with `formatPlaceLabel`. So on every
 * keystroke the caller hands back a DIFFERENT label than the one in the box.
 * These two tests are the regression guard for that loop.
 */
describe('wired the way the doctor registration form wires it', () => {
  function DoctorPayloadHarness() {
    const [doctor, setDoctor] = useState({
      city: '', state: '', country: '', latitude: null, longitude: null,
    });
    const patch = (next) => setDoctor((current) => ({ ...current, ...next }));

    const location = doctor.city || doctor.state || doctor.country
      ? { ...doctor, label: formatPlaceLabel(doctor) }
      : null;

    return (
      <>
        <LocationSearch
          label="City"
          debounce={DEBOUNCE}
          value={location}
          onChange={(place) => (place
            ? patch({
              city: place.city,
              state: place.state,
              country: place.country,
              latitude: place.latitude,
              longitude: place.longitude,
            })
            : patch({ city: '', state: '', country: '' }))}
          onTextChange={(text) => patch({ city: text, state: '', country: '' })}
        />
        <output data-testid="payload">{JSON.stringify(doctor)}</output>
      </>
    );
  }

  it('keeps a hand-typed city character for character, and puts it in the payload', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([]));
    const user = userEvent.setup();
    render(<DoctorPayloadHarness />);

    await user.type(screen.getByRole('combobox', { name: 'City' }), 'Chak Jhumra');

    expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue('Chak Jhumra');
    expect(JSON.parse(screen.getByTestId('payload').textContent)).toMatchObject({
      city: 'Chak Jhumra',
      state: '',
      country: '',
    });
  });

  it('fills city, state, country AND the coordinates from one pick', async () => {
    const user = userEvent.setup();
    render(<DoctorPayloadHarness />);
    const input = screen.getByRole('combobox', { name: 'City' });

    await user.click(input);
    await user.type(input, 'islam');
    const listbox = await screen.findByRole('listbox');
    await waitFor(() => {
      expect(within(listbox).getAllByRole('option').length).toBeGreaterThan(0);
    });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(JSON.parse(screen.getByTestId('payload').textContent)).toEqual({
      city: 'Islamabad',
      state: 'Islamabad Capital Territory',
      country: 'Pakistan',
      latitude: 33.6001033,
      longitude: 73.0442278,
    });
    // The box now shows the label the FORM derives, not Nominatim's long one.
    expect(input).toHaveValue('Islamabad, Islamabad Capital Territory, Pakistan');
  });
});
