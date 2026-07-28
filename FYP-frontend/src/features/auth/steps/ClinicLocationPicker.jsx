/**
 * ClinicLocationPicker — pin the clinic on a map.
 *
 * LAZY ON PURPOSE. Leaflet plus react-leaflet plus the marker sprites is the
 * single biggest dependency on the auth screen, and NOBODY signing in needs it:
 * it is reachable only from SignupDetailsStep, only after the "I am a
 * healthcare professional" switch is on. This module is therefore the ONLY
 * place in `features/auth` that imports leaflet, and it is loaded through
 * `React.lazy`, so `leaflet.css` and the sprites land in their own chunk that
 * the sign-in path never downloads.
 *
 * The stored latitude/longitude are what `/api/doctors/public` uses to rank
 * "nearby doctors", so an approximate pin is genuinely useful and an absent one
 * is not fatal — the field is optional and the form says so.
 *
 * TWO-WAY SYNC WITH THE LOCATION SEARCH
 * -------------------------------------
 * The map and the city combobox above it describe ONE place, so they must never
 * disagree:
 *
 *   search -> map   the caller feeds the chosen coordinates back in as
 *                   `latitude`/`longitude`; `Recenter` moves the view and the
 *                   marker follows.
 *   map -> search   every pin the USER places (a tap, or "Use my location") is
 *                   reverse geocoded and reported through `onResolvePlace`, so
 *                   city/state/country fill themselves in.
 *
 * The reverse lookup deliberately runs ONLY for user gestures inside this
 * component. Reverse geocoding a pin that arrived FROM the search would
 * overwrite the name the user just picked with whatever Nominatim calls that
 * coordinate, and the two would ping-pong.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, MapPin } from 'lucide-react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import { Button, cn } from '../../../components/ui';
import { lookupReverse } from '../../../lib/geocode';

// Leaflet resolves its default marker sprites with a relative URL that Vite
// cannot rewrite; without this the pin renders as a broken image.
const DefaultIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

/** Islamabad — a sane default for a Pakistan-first product. */
const FALLBACK_CENTER = [33.6844, 73.0479];

/** Close enough to read street names once a place is actually chosen. */
const PINNED_MIN_ZOOM = 13;

function ClickToPlace({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => {
    // Never zoom OUT: if the user pinched in to place the pin precisely, a
    // selection from the search box should not throw that work away.
    if (center) map.setView(center, Math.max(map.getZoom(), PINNED_MIN_ZOOM));
  }, [center, map]);
  return null;
}

/**
 * @param {object} props
 * @param {number|null} props.latitude
 * @param {number|null} props.longitude
 * @param {(lat:number, lng:number) => void} props.onChange Called for every pin move.
 * @param {(place:object) => void} [props.onResolvePlace] Called with the
 *   normalised `{label, city, state, country, latitude, longitude}` after a
 *   USER-placed pin is reverse geocoded. Never called for a pin that arrived
 *   through props, and never called when the lookup fails.
 * @param {string} [props.className]
 */
export default function ClinicLocationPicker({
  latitude,
  longitude,
  onChange,
  onResolvePlace,
  className,
}) {
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolvedLabel, setResolvedLabel] = useState('');

  /** In-flight reverse lookup, aborted the moment the pin moves again. */
  const reverseRef = useRef(null);
  const mountedRef = useRef(true);
  const resolveRef = useRef(onResolvePlace);

  useEffect(() => {
    resolveRef.current = onResolvePlace;
  }, [onResolvePlace]);

  useEffect(() => {
    // Re-arm on every mount: StrictMode runs effects twice in development and
    // the cleanup below would otherwise leave the second mount marked dead.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      reverseRef.current?.abort();
    };
  }, []);

  const position = useMemo(
    () => (Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null),
    [latitude, longitude],
  );

  /**
   * Move the pin AND name the place. The coordinates are reported first so the
   * form never waits on the network to record what the user did.
   */
  const placePin = useCallback(async (lat, lng) => {
    onChange(lat, lng);

    reverseRef.current?.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    reverseRef.current = controller;

    setResolving(true);
    setResolvedLabel('');

    const outcome = await lookupReverse(lat, lng, { signal: controller?.signal });
    if (!mountedRef.current || outcome.status === 'aborted') return;

    setResolving(false);
    const place = outcome.place;
    // A pin in the middle of a lake normalises to no city, no state and no
    // country. Reporting that would blank a city the user typed by hand, so an
    // empty answer is simply not an answer.
    if (place && (place.city || place.state || place.country)) {
      setResolvedLabel([place.city, place.state, place.country].filter(Boolean).join(', '));
      resolveRef.current?.(place);
    }
  }, [onChange]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('This browser cannot share your location. Tap the map instead.');
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (found) => {
        setLocating(false);
        placePin(found.coords.latitude, found.coords.longitude);
      },
      () => {
        setLocating(false);
        setGeoError('We could not read your location. Tap the map to place the pin instead.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-muted">
          Tap the map to place your clinic. Patients use this to find doctors near them.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={locating}
          onClick={useMyLocation}
          leftIcon={<Crosshair aria-hidden="true" className="h-4 w-4" />}
        >
          Use my location
        </Button>
      </div>

      <div className="h-56 w-full overflow-hidden rounded-card border border-default">
        <MapContainer
          center={position || FALLBACK_CENTER}
          zoom={position ? 14 : 11}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution="Google Maps"
            url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
          />
          <ClickToPlace onPick={placePin} />
          {position && <Marker position={position} />}
          {position && <Recenter center={position} />}
        </MapContainer>
      </div>

      <p className="flex items-center gap-1.5 text-caption text-subtle" aria-live="polite">
        <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>
          {position
            ? `Pinned at ${position[0].toFixed(4)}, ${position[1].toFixed(4)}`
            : 'No location pinned yet (optional).'}
          {resolving && position ? ' Looking up the address…' : ''}
          {!resolving && resolvedLabel ? ` (${resolvedLabel})` : ''}
        </span>
      </p>

      {geoError && (
        <p role="alert" className="text-caption font-medium text-warning-600">{geoError}</p>
      )}
    </div>
  );
}

export { ClinicLocationPicker };
