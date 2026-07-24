import React, { useState, useEffect } from 'react';

const UVWidget = () => {
  const [weatherData, setWeatherData] = useState({ temp: null, uv: null, location: 'Locating...' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 🧠 1. Get user's recent scan result from memory
  const savedScan = typeof window !== 'undefined' ? sessionStorage.getItem("lastScanResult") : null;
  let userCondition = null;
  if (savedScan) {
    try {
      const scanData = JSON.parse(savedScan);
      userCondition = scanData.disease || scanData.condition;
    } catch (e) {
      console.error("Failed to parse scan data for UV widget");
    }
  }

  useEffect(() => {
    // Function to fetch Location Details and UV Data
    const fetchUVData = async (lat, lon, fallbackLocation) => {
      try {
        // Step 1: OpenStreetMap (Nominatim) API se Exact Area, City, Country nikalna
        let exactLocation = fallbackLocation;
        try {
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
          );
          const geoData = await geoRes.json();
          
          if (geoData && geoData.address) {
            const addr = geoData.address;
            
            // Area ke liye alag alag keys check karna (jo bhi available ho)
            const area = addr.suburb || addr.neighbourhood || addr.residential || addr.city_district || '';
            const city = addr.city || addr.town || addr.village || addr.county || '';
            const country = addr.country || '';
            
            // Inko combine kar ke ek string banana
            const locationParts = [area, city, country].filter(Boolean);
            if (locationParts.length > 0) {
              // Agar 3 se zyada parts ban jayein toh sirf pehle 3 dikhaye taake lamba na ho
              exactLocation = locationParts.slice(0, 3).join(', ');
            }
          }
        } catch (geoErr) {
          console.error('Error fetching location name:', geoErr);
        }

        // Step 2: Open-Meteo se Weather / UV Data lana
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,uv_index&timezone=auto`
        );
        const data = await response.json();
        
        setWeatherData({
          temp: Math.round(data.current.temperature_2m),
          uv: data.current.uv_index.toFixed(1),
          location: exactLocation
        });
        setLoading(false);
      } catch (err) {
        setError('Failed to load weather data');
        setLoading(false);
      }
    };

    // User ki Real Location Get Karna
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Success: Use their actual GPS coordinates
          fetchUVData(position.coords.latitude, position.coords.longitude, 'Detecting Area...');
        },
        (error) => {
          // Failed/Denied: Default to Lahore coordinates
          fetchUVData(31.5497, 74.3436, 'Lahore, Pakistan');
        }
      );
    } else {
      fetchUVData(31.5497, 74.3436, 'Lahore, Pakistan');
    }
  }, []);

  // 🧠 2. UI and Logic based on UV severity and User Condition
  const getUvInfo = (uv) => {
    let baseInfo = {};

    if (uv <= 2) {
      baseInfo = { level: 'Low', color: 'bg-green-100 text-green-700', border: 'border-green-200', tip: 'Safe to be outside. No special protection needed.', icon: '🌤️' };
    } else if (uv <= 5) {
      baseInfo = { level: 'Moderate', color: 'bg-yellow-100 text-yellow-700', border: 'border-yellow-200', tip: 'Wear Sunscreen SPF 30+ and a hat if outside.', icon: '🌥️' };
    } else if (uv <= 7) {
      baseInfo = { level: 'High', color: 'bg-orange-100 text-orange-700', border: 'border-orange-200', tip: 'High UV! Wear Sunscreen SPF 50+, hat, and sunglasses.', icon: '☀️' };
    } else if (uv <= 10) {
      baseInfo = { level: 'Very High', color: 'bg-red-100 text-red-700', border: 'border-red-200', tip: 'Avoid sun exposure during midday. Extra protection needed!', icon: '🔥' };
    } else {
      baseInfo = { level: 'Extreme', color: 'bg-purple-100 text-purple-700', border: 'border-purple-200', tip: 'Dangerous UV levels! Stay indoors if possible.', icon: '☠️' };
    }

    // 🔥 DYNAMIC AI ALERT: Agar user ko koi bemari hai aur dhoop tez hai!
    if (userCondition && uv > 4) {
      baseInfo.tip = (
        <>
          High UV can trigger your <strong className="text-red-600 capitalize uppercase">{userCondition}</strong>! Please do not go outside without strong sunscreen and protection.
        </>
      );
      baseInfo.color = 'bg-red-50 text-red-700'; // Alert styling
      baseInfo.border = 'border-red-300';
    }

    return baseInfo;
  };

  if (loading) return (
    <div className="animate-pulse bg-slate-50 border border-slate-100 rounded-3xl p-6 max-w-sm w-full">
      <div className="h-4 bg-slate-200 rounded w-1/2 mb-4"></div>
      <div className="h-10 bg-slate-200 rounded w-full"></div>
    </div>
  );

  if (error) return null;

  const info = getUvInfo(weatherData.uv);

  return (
    <div className={`rounded-[2rem] p-6 max-w-sm w-full border-2 transition-all shadow-sm ${info.border} bg-white`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex-1 overflow-hidden pr-2">
          <h3 className="text-slate-800 font-bold flex items-center gap-2">
            <SunIcon className="text-amber-500 w-5 h-5 flex-shrink-0" />
            Skin Weather
          </h3>
          {/* Location Text with Truncate for long addresses */}
          <p className="text-xs text-slate-400 font-medium tracking-wide flex items-center gap-1 mt-1 truncate" title={weatherData.location}>
            <MapPinIcon className="w-3 h-3 flex-shrink-0" /> 
            <span className="truncate">{weatherData.location}</span>
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <span className="text-2xl font-black text-slate-800">{weatherData.temp}°C</span>
        </div>
      </div>

      {/* Main UV Status */}
      <div className={`p-4 rounded-2xl flex items-center justify-between mb-4 ${info.color}`}>
        <div>
          <p className="text-xs font-black uppercase tracking-widest opacity-80 mb-1">UV Index</p>
          <p className="text-3xl font-black">{weatherData.uv}</p>
        </div>
        <div className="text-right">
          <span className="text-4xl">{info.icon}</span>
          <p className="font-bold mt-1">{info.level}</p>
        </div>
      </div>

      {/* AI Skincare Tip */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex gap-3 items-start">
        <ShieldIcon className="w-5 h-5 text-teal-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-slate-600 font-medium leading-relaxed">
          <span className="font-bold text-slate-800">AI Tip: </span> 
          {info.tip}
        </p>
      </div>
    </div>
  );
};

// SVG Icons
const SunIcon = ({className}) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
);
const MapPinIcon = ({className}) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
);
const ShieldIcon = ({className}) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
);

export default UVWidget;