/**
 * DoctorMap — the same filtered doctor list, on a map.
 *
 * LAZY ON PURPOSE
 * ---------------
 * This is the ONLY module in `features/consult` that imports Leaflet, and
 * StepDoctors pulls it in through `React.lazy`. Leaflet plus react-leaflet plus
 * `leaflet.css` and the marker sprites is a ~161 kB chunk; the consult flow's own
 * chunk is a fraction of that, and the majority of patients never press "Map".
 * Importing it statically anywhere in this feature would put it on the critical
 * path for the photo-upload step, which is the one step everybody uses — often
 * on a phone, on mobile data, with a skin problem they are anxious about.
 *
 * MARKERS ARE NOT THE ONLY WAY TO SELECT
 * --------------------------------------
 * A map pin is a poor primary control: it is small, it is not in the tab order
 * in any meaningful reading order, and it conveys "selected" by colour alone.
 * So the map is a SECOND view, never the only one — the list view carries real
 * checkboxes, and every marker's popup repeats the doctor's details as text with
 * a real button. Selection state is shown by colour AND by size AND by the
 * numbered badge in the popup, so it does not depend on colour perception.
 *
 * A doctor whose clinic was never pinned during signup has `latitude`/`longitude`
 * of null. Those are counted and named under the map rather than silently
 * dropped, because "8 of 23 doctors have not shared a location" is information;
 * a map that quietly shows 15 of 23 is a map that lies.
 */

import React, { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Check, ExternalLink, MapPin, Star } from 'lucide-react';

import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import { Button, cn } from '../../../components/ui';
import { formatCurrency } from '../../../lib/format';
import { FALLBACK_CENTER, formatDistance } from '../lib/geo';

// Vite cannot rewrite Leaflet's relative sprite URLs, so the default icon is
// rebuilt from the imported asset URLs. Without this every pin is a broken image.
L.Marker.prototype.options.icon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

/**
 * Selected and unselected pins as divIcons, so their colours come from the same
 * semantic tokens as the rest of the app and flip with the theme.
 */
function pinIcon({ selected, label }) {
  const dot = selected
    ? 'h-7 w-7 bg-primary-600 text-white text-[0.75rem]'
    : 'h-5 w-5 bg-surface text-transparent';
  return L.divIcon({
    className: 'ui-doctor-pin',
    html: `<span class="${cn(
      'flex items-center justify-center rounded-pill border-2 font-bold shadow-card',
      selected ? 'border-white' : 'border-primary-600',
      dot,
    )}">${selected ? label ?? '' : ''}</span>`,
    iconSize: selected ? [28, 28] : [20, 20],
    iconAnchor: selected ? [14, 14] : [10, 10],
    popupAnchor: [0, selected ? -16 : -12],
  });
}

const originIcon = L.divIcon({
  className: 'ui-origin-pin',
  html: '<span class="block h-4 w-4 rounded-pill border-2 border-white bg-accent-700 shadow-card"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/** Keep every pin in frame whenever the filtered set changes. */
function FitToMarkers({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 14 });
  }, [map, points]);
  return null;
}

/**
 * @param {object} props
 * @param {Array<object>} props.doctors The already filtered + sorted list.
 * @param {Set<number>} props.selectedIds
 * @param {(doctor:object)=>void} props.onToggle
 * @param {[number,number]|null} [props.origin] The patient's position, if shared.
 * @param {boolean} [props.full] The three-doctor cap is reached.
 */
export default function DoctorMap({ doctors, selectedIds, onToggle, origin, full = false }) {
  const located = useMemo(() => doctors.filter((doctor) => doctor.coords), [doctors]);
  const missing = doctors.length - located.length;

  const points = useMemo(() => {
    const list = located.map((doctor) => doctor.coords);
    return origin ? [...list, origin] : list;
  }, [located, origin]);

  const center = points[0] || FALLBACK_CENTER;

  return (
    <div className="space-y-2">
      <div className="h-[22rem] w-full overflow-hidden rounded-card border border-subtle sm:h-[28rem]">
        <MapContainer
          center={center}
          zoom={11}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution="Google Maps"
            url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
          />
          <FitToMarkers points={points} />

          {origin && (
            <Marker position={origin} icon={originIcon} zIndexOffset={500}>
              <Popup>You are here</Popup>
            </Marker>
          )}

          {located.map((doctor) => {
            const selected = selectedIds.has(doctor.id);
            return (
              <Marker
                key={doctor.id}
                position={doctor.coords}
                icon={pinIcon({ selected, label: '✓' })}
                zIndexOffset={selected ? 400 : 0}
                alt={`${doctor.name}, ${doctor.specialty}`}
              >
                <Popup>
                  <div className="min-w-[12rem] space-y-1.5 font-body">
                    <p className="text-label-lg text-default">{doctor.name}</p>
                    <p className="text-caption text-muted">{doctor.specialty}</p>
                    {(doctor.hospital || doctor.city) && (
                      <p className="flex items-start gap-1 text-caption text-subtle">
                        <MapPin aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
                        {[doctor.hospital, doctor.city].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <p className="flex flex-wrap items-center gap-x-2 text-caption text-muted">
                      {doctor.rating === null ? (
                        <span>Not rated yet</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Star aria-hidden="true" className="h-3.5 w-3.5 fill-warning-400 text-warning-500" />
                          {doctor.rating.toFixed(1)} ({doctor.reviews})
                        </span>
                      )}
                      <span>
                        {doctor.feePkr === null ? 'Fee not listed' : formatCurrency(doctor.feePkr, 'PKR')}
                      </span>
                      {doctor.distance !== null && doctor.distance !== undefined && (
                        <span>{formatDistance(doctor.distance)} away</span>
                      )}
                    </p>
                    <a
                      href={`https://www.google.com/maps?q=${doctor.coords[0]},${doctor.coords[1]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-caption font-semibold text-accent-700 hover:underline dark:text-accent-400"
                    >
                      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                      Open in Google Maps
                    </a>
                    {/* `soft` for the chosen state, never `outline`: a
                        transparent button inside a popup that leaflet paints
                        itself is the one combination that can vanish. This one
                        carries its own fill in both themes. */}
                    <Button
                      type="button"
                      size="sm"
                      variant={selected ? 'soft' : 'primary'}
                      disabled={full && !selected}
                      onClick={() => onToggle?.(doctor)}
                      leftIcon={selected ? <Check aria-hidden="true" className="h-4 w-4" /> : undefined}
                      fullWidth
                      className="mt-1"
                    >
                      {selected ? 'Chosen. Tap to remove' : 'Add to my request'}
                    </Button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      <p className="text-caption text-subtle">
        {located.length} of {doctors.length} shown on the map.
        {missing > 0 && ` ${missing} ${missing === 1 ? 'doctor has' : 'doctors have'} not shared a clinic location; switch to the list to see them.`}
        {' '}Pins are approximate; distances are straight-line, not driving time.
      </p>
    </div>
  );
}

export { DoctorMap };
