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
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Crosshair, MapPin } from 'lucide-react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import { Button, cn } from '../../../components/ui';

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
    if (center) map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

/**
 * @param {object} props
 * @param {number|null} props.latitude
 * @param {number|null} props.longitude
 * @param {(lat:number, lng:number) => void} props.onChange
 * @param {string} [props.className]
 */
export default function ClinicLocationPicker({ latitude, longitude, onChange, className }) {
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState(null);

  const position = useMemo(
    () => (Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null),
    [latitude, longitude],
  );

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
        onChange(found.coords.latitude, found.coords.longitude);
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
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickToPlace onPick={onChange} />
          {position && <Marker position={position} />}
          {position && <Recenter center={position} />}
        </MapContainer>
      </div>

      <p className="flex items-center gap-1.5 text-caption text-subtle" aria-live="polite">
        <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
        {position
          ? `Pinned at ${position[0].toFixed(4)}, ${position[1].toFixed(4)}`
          : 'No location pinned yet (optional).'}
      </p>

      {geoError && (
        <p role="alert" className="text-caption font-medium text-warning-600">{geoError}</p>
      )}
    </div>
  );
}

export { ClinicLocationPicker };
