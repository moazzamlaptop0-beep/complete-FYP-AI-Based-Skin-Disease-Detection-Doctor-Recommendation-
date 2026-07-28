import React, { useState, useEffect } from 'react';
import {
  CloudOff,
  Flame,
  MapPin,
  ShieldCheck,
  Sun,
  SunDim,
  SunMedium,
  TriangleAlert,
} from 'lucide-react';

/**
 * Live "skin weather" widget: local temperature and UV index with a sun-care
 * tip. THEME-ADAPTIVE: token-based throughout, so it sits on any surface card
 * and reads correctly in light and dark mode (the token scales flip).
 *
 * Tonal mapping by UV index: success (low), warning (moderate/high),
 * danger (very high/extreme).
 */

const TONES = {
  success: {
    panel: 'border-success-200 bg-success-50',
    chip: 'bg-success-100 text-success-700',
    icon: 'text-success-600',
  },
  warning: {
    panel: 'border-warning-200 bg-warning-50',
    chip: 'bg-warning-100 text-warning-700',
    icon: 'text-warning-600',
  },
  danger: {
    panel: 'border-danger-200 bg-danger-50',
    chip: 'bg-danger-100 text-danger-700',
    icon: 'text-danger-600',
  },
};

/** UI copy and tone for a UV index reading. */
const getUvInfo = (uv) => {
  const value = Number(uv);

  if (value <= 2) {
    return {
      level: 'Low',
      tone: 'success',
      icon: SunDim,
      tip: 'Safe to be outside. No special protection needed.',
    };
  }
  if (value <= 5) {
    return {
      level: 'Moderate',
      tone: 'warning',
      icon: SunMedium,
      tip: 'Wear SPF 30+ sunscreen and a hat if you are outside.',
    };
  }
  if (value <= 7) {
    return {
      level: 'High',
      tone: 'warning',
      icon: Sun,
      tip: 'High UV. Wear SPF 50+ sunscreen, a hat, and sunglasses.',
    };
  }
  if (value <= 10) {
    return {
      level: 'Very high',
      tone: 'danger',
      icon: Flame,
      tip: 'Avoid sun exposure during midday. Extra protection needed.',
    };
  }
  return {
    level: 'Extreme',
    tone: 'danger',
    icon: TriangleAlert,
    tip: 'Dangerous UV levels. Stay indoors if possible.',
  };
};

const UVWidget = () => {
  const [weatherData, setWeatherData] = useState({ temp: null, uv: null, location: 'Locating...' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Fetch a readable place name and the current temperature + UV index.
    const fetchUVData = async (lat, lon, fallbackLocation) => {
      try {
        // Step 1: reverse-geocode via OpenStreetMap (Nominatim) to get the
        // exact area, city, and country.
        let exactLocation = fallbackLocation;
        try {
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
          );
          const geoData = await geoRes.json();

          if (geoData && geoData.address) {
            const addr = geoData.address;

            // The "area" can live under several different keys; take whichever
            // is available.
            const area = addr.suburb || addr.neighbourhood || addr.residential || addr.city_district || '';
            const city = addr.city || addr.town || addr.village || addr.county || '';
            const country = addr.country || '';

            // Combine the parts into one string.
            const locationParts = [area, city, country].filter(Boolean);
            if (locationParts.length > 0) {
              // Cap at three parts so the label never gets too long.
              exactLocation = locationParts.slice(0, 3).join(', ');
            }
          }
        } catch (geoErr) {
          console.error('Error fetching location name:', geoErr);
        }

        // Step 2: fetch weather / UV data from Open-Meteo.
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,uv_index&timezone=auto`
        );
        const data = await response.json();

        setWeatherData({
          temp: Math.round(data.current.temperature_2m),
          uv: data.current.uv_index.toFixed(1),
          location: exactLocation,
        });
        setLoading(false);
      } catch (err) {
        console.error('Error fetching UV data:', err);
        setError('We could not reach the weather service.');
        setLoading(false);
      }
    };

    // Get the user's real location, falling back to Lahore when geolocation is
    // unavailable or denied.
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Success: use their actual GPS coordinates.
          fetchUVData(position.coords.latitude, position.coords.longitude, 'Detecting area...');
        },
        () => {
          // Failed or denied: default to Lahore coordinates.
          fetchUVData(31.5497, 74.3436, 'Lahore, Pakistan');
        }
      );
    } else {
      fetchUVData(31.5497, 74.3436, 'Lahore, Pakistan');
    }
  }, []);

  if (loading) {
    return (
      <div className="w-full max-w-sm p-6 sm:p-7" role="status" aria-live="polite">
        <span className="sr-only">Loading local UV conditions</span>
        <div className="animate-pulse space-y-4" aria-hidden="true">
          <div className="h-4 w-1/2 rounded-pill bg-surface-sunken" />
          <div className="h-20 rounded-card bg-surface-sunken" />
          <div className="h-14 rounded-field bg-surface-sunken" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-sm p-6 sm:p-7" role="status">
        <div className="flex items-start gap-3 rounded-field border border-subtle bg-surface-sunken p-4">
          <CloudOff size={20} className="mt-0.5 shrink-0 text-subtle" aria-hidden="true" />
          <div>
            <p className="text-label-md text-default">Live UV data unavailable</p>
            <p className="mt-1 text-body-sm text-muted">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const info = getUvInfo(weatherData.uv);
  const tone = TONES[info.tone];
  const LevelIcon = info.icon;

  return (
    <div className="w-full max-w-sm p-6 font-body sm:p-7">
      {/* Header: title, location, temperature */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-heading-sm text-default">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-field bg-accent-100 text-accent-700">
              <Sun size={15} aria-hidden="true" />
            </span>
            Skin weather
          </h2>
          <p
            className="mt-1.5 flex items-center gap-1.5 text-caption text-subtle"
            title={weatherData.location}
          >
            <MapPin size={13} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{weatherData.location}</span>
          </p>
        </div>
        <p className="shrink-0 text-right">
          <span className="font-numeric text-display-sm text-default">{weatherData.temp}°</span>
          <span className="block text-caption text-subtle">Celsius</span>
        </p>
      </div>

      {/* Current UV status */}
      <div
        className={`mb-4 flex items-center justify-between gap-4 rounded-card border p-4 ${tone.panel}`}
      >
        <div>
          <p className="text-overline uppercase tracking-widest text-muted">UV index</p>
          <p className="mt-1 font-numeric text-4xl font-bold text-default">{weatherData.uv}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <LevelIcon size={26} className={tone.icon} aria-hidden="true" />
          <span className={`rounded-pill px-2.5 py-1 text-label-sm ${tone.chip}`}>
            {info.level}
          </span>
        </div>
      </div>

      {/* Sun-care tip */}
      <div className="flex items-start gap-3 rounded-field border border-subtle bg-surface-sunken p-4">
        <ShieldCheck
          size={20}
          className="mt-0.5 shrink-0 text-accent-700 dark:text-accent-400"
          aria-hidden="true"
        />
        <p className="text-body-sm leading-relaxed text-muted">
          <span className="font-semibold text-default">Sun tip: </span>
          {info.tip}
        </p>
      </div>
    </div>
  );
};

export default UVWidget;
