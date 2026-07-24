// src/components/doctor-directory/NearbyDoctors.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css'; 
import L from 'leaflet';
import { 
  Phone, Send, CheckCircle2, ArrowLeft, Search, Loader, 
  AlertCircle, XCircle, Clock, LayoutDashboard, Star,
  MapPin, Stethoscope, CalendarDays, Award, Sparkles, User,
  BadgeCheck, Clock3
} from 'lucide-react';

import PreReportQuestionnaireModal from './PreReportQuestionnaireModal';
import EmergencySuccessScreen from './EmergencySuccessScreen';

// Leaflet Icons Fix
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Custom Icons
const userIcon = new L.Icon({
  iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-2x-black.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const invitedDoctorIcon = new L.Icon({
  iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const normalDoctorIcon = new L.Icon({
  iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-2x-blue.png', 
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

// Text Formatting Helpers
const formatDoctorName = (name) => {
  if (!name) return "Doctor";
  let cleanName = name.trim();
  if (!cleanName.toLowerCase().startsWith('dr.')) {
    cleanName = 'Dr. ' + cleanName;
  }
  return cleanName.replace(/\b\w/g, char => char.toUpperCase());
};

const formatSpecialization = (spec) => {
  if (!spec) return "Medical Specialist";
  const upper = spec.toUpperCase().trim();
  if (upper === 'ACNE') return 'Acne Specialist';
  if (upper === 'DERMA' || upper === 'DERMATOLOGY') return 'Dermatologist';
  return spec.replace(/\b\w/g, char => char.toUpperCase());
};

const formatHospitalName = (hosp) => {
  // BUG FIX: pehle yahan "Medical Center" (ek aur specific-lagne wala fake naam)
  // return hota tha. Ab null — caller ko explicitly "not added" state dikhani
  // hogi, kisi asli jagah jaisa lagne wala naam nahi.
  if (!hosp) return null;
  return hosp.trim().replace(/\b\w/g, char => char.toUpperCase());
};

const formatExperience = (exp) => {
  if (!exp) return null;
  const expStr = exp.toString().trim();
  if (expStr.toLowerCase().includes('year')) return expStr;
  return `${expStr} Years Experience`;
};

// Admin license verification badge shown on doctor cards.
// 'approved' -> blue "Verified" tick. Anything else (pending/missing) -> amber "Pending Verification".
const VerificationBadge = ({ status }) => {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-0.5 bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide shrink-0">
        <BadgeCheck size={10} /> Verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide shrink-0">
      <Clock3 size={10} /> Pending Verification
    </span>
  );
};

// 12-Hour Time Formatter
const formatTime12h = (timeStr) => {
  if (!timeStr) return '';
  if (timeStr.toLowerCase().includes('am') || timeStr.toLowerCase().includes('pm')) {
    return timeStr; 
  }
  
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  
  hours = hours % 12;
  hours = hours ? hours : 12; 
  
  return `${hours}:${minutes} ${ampm}`;
};

const FixMapDisplay = () => {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => { map.invalidateSize(); }, 250); 
  }, [map]);
  return null;
};

const RecenterAutomatically = ({ lat, lng, zoom }) => {
  const map = useMap();
  useEffect(() => {
    if (lat && lng) {
        map.flyTo([lat, lng], zoom || 14, { duration: 1.5, easeLinearity: 0.25 });
    }
  }, [lat, lng, map, zoom]);
  return null;
};

const resolveScanContext = (routerState) => {
  if (routerState?.scan_id) {
    return {
      scan_id: routerState.scan_id,
      disease: routerState.disease || '',
      doctor_id: routerState.doctor_id || ''
    };
  }

  try {
    const saved = sessionStorage.getItem('lastScanResult');
    if (saved) {
      const parsed = JSON.parse(saved);
      const ageMinutes = (Date.now() - parsed.timestamp) / 60000;
      if (parsed.scan_id && ageMinutes < 30) {
        return { scan_id: parsed.scan_id, disease: parsed.disease || '', doctor_id: '' };
      }
    }
  } catch (err) {
    console.error('Failed to validate cached scan context:', err);
  }

  return { scan_id: '', disease: '', doctor_id: '' };
};

// Smart Utility to parse exact matching and day ranges natively
const isDoctorAvailableOnDay = (schedule, targetDate = new Date()) => {
  if (!schedule || !Array.isArray(schedule)) return false;

  const fullDays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const shortDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  
  const targetDayIdx = targetDate.getDay();
  const targetFull = fullDays[targetDayIdx];
  const targetShort = shortDays[targetDayIdx];

  return schedule.some(slot => {
    const isAvailable = slot.available !== undefined ? slot.available : (!slot.off && !slot.is_off);
    if (!isAvailable) return false;
    if (!slot.day) return false;
    
    const slotDayClean = slot.day.toLowerCase().trim();

    // Exact Match
    if (slotDayClean === targetFull || slotDayClean === targetShort) {
      return true;
    }

    // Range Parsing (e.g., "Mon - Fri")
    if (slotDayClean.includes('-')) {
      const parts = slotDayClean.split('-').map(d => d.trim());
      if (parts.length === 2) {
        let startDay = parts[0];
        let endDay = parts[1];

        let startIdx = fullDays.indexOf(startDay);
        if (startIdx === -1) startIdx = shortDays.indexOf(startDay.substring(0, 3));

        let endIdx = fullDays.indexOf(endDay);
        if (endIdx === -1) endIdx = shortDays.indexOf(endDay.substring(0, 3));

        if (startIdx !== -1 && endIdx !== -1) {
          if (startIdx <= endIdx) {
            return targetDayIdx >= startIdx && targetDayIdx <= endIdx;
          } else {
            return targetDayIdx >= startIdx || targetDayIdx <= endIdx;
          }
        }
      }
    }
    return false;
  });
};

// Helper to convert day strings (like 'mon', 'tue') into target calendar dates
const getTargetDateFromDayStr = (dayStr) => {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const targetIdx = days.indexOf(dayStr.toLowerCase());
  if (targetIdx === -1) return new Date();

  const today = new Date();
  const currentIdx = today.getDay();
  
  let daysToAdd = targetIdx - currentIdx;
  if (daysToAdd < 0) daysToAdd += 7; 

  const targetDate = new Date();
  targetDate.setDate(today.getDate() + daysToAdd);
  return targetDate;
};

const NearbyDoctors = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const markerRefs = useRef({}); 
  
  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  const [scanId, setScanId] = useState(() => resolveScanContext(location.state).scan_id);
  const [diseaseState, setDiseaseState] = useState(() => resolveScanContext(location.state).disease);
  const [doctorIdState, setDoctorIdState] = useState(() => resolveScanContext(location.state).doctor_id);

  const [userLocation, setUserLocation] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [radiusFilter, setRadiusFilter] = useState('all'); 
  const [sortBy, setSortBy] = useState('distance'); 
  const [dayFilter, setDayFilter] = useState('all'); 
  
  const [successState, setSuccessState] = useState(() => {
    const currentScanId = resolveScanContext(location.state).scan_id;
    if (!currentScanId) return null;
    const savedSuccess = localStorage.getItem(`success_state_${currentScanId}`);
    return savedSuccess ? JSON.parse(savedSuccess) : null;
  });
  
  // BUG FIX: pehle yahan localStorage se `sent_report_<scanId>` seedha trust
  // ho jata tha. scan_id sirf DB ka auto-increment integer hai - dev/test
  // DB reset hote hi naya scan purana id reuse kar leta hai, aur wahi purana
  // localStorage flag is bilkul naye scan ko "already sent" dikha deta tha
  // (naya account, pehla scan, phir bhi button disabled). Ab backend hi
  // source-of-truth hai - neeche wala useEffect /api/scans/:id/report-status
  // se asli state fetch karta hai, yahan sirf safe default false.
  const [hasSentReport, setHasSentReport] = useState(false);
  const [checkingReportStatus, setCheckingReportStatus] = useState(true);
  const [sendingReportId, setSendingReportId] = useState(null);
  
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [notification, setNotification] = useState({ show: false, type: '', title: '', message: '' });

  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [pendingReportData, setPendingReportData] = useState(null);

  useEffect(() => {
    if (!scanId) {
      navigate('/try-now', { replace: true });
    }
  }, [scanId, navigate]);

  useEffect(() => {
    if (location.state) {
      if (location.state.scan_id) setScanId(location.state.scan_id);
      if (location.state.disease) setDiseaseState(location.state.disease);
      if (location.state.doctor_id) setDoctorIdState(location.state.doctor_id);
    }
  }, [location.state]);

  useEffect(() => {
    const handlePageShow = (event) => {
      if (event.persisted && !resolveScanContext(location.state).scan_id) {
        navigate('/try-now', { replace: true });
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [location.state, navigate]);

  // BUG FIX (continued): scan_id set hote hi backend se real "report already
  // sent?" state fetch karo, taake button ka lock localStorage ke bajaye
  // hamesha is scan ke asli DB state (doctor_id set hai ya nahi) se match kare.
  useEffect(() => {
    if (!scanId) { setCheckingReportStatus(false); return; }

    const checkReportStatus = async () => {
      setCheckingReportStatus(true);
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE_URL}/api/scans/${scanId}/report-status`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const resData = await res.json();
        if (resData.success) {
          setHasSentReport(!!resData.data.report_sent);
        }
      } catch (err) {
        console.error('Failed to check report status:', err);
      } finally {
        setCheckingReportStatus(false);
      }
    };
    checkReportStatus();
  }, [scanId, API_BASE_URL]);

  const showNotification = (type, title, message) => {
    setNotification({ show: true, type, title, message });
    setTimeout(() => { setNotification({ show: false, type: '', title: '', message: '' }); }, 4000);
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return "N/A";
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return (R * c).toFixed(1); 
  };

  useEffect(() => {
    if (!scanId) return;

    const initData = async () => {
      setLoading(true);
      const fallbackLocation = () => setUserLocation([31.5204, 74.3587]);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => { setUserLocation([pos.coords.latitude, pos.coords.longitude]); }, fallbackLocation);
      } else { fallbackLocation(); }

      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE_URL}/api/doctors/public`, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
        const resData = await res.json();

        if (resData.success) {
          const enrichedDoctors = resData.data.map((doc, idx) => ({
            ...doc,
            // BUG FIX: pehle missing coordinates ke liye Lahore ke aas-paas ek fake
            // offset (31.5204 + idx*0.015) generate hota tha, jisse patient ko
            // specific-lagne wali "3.4 km door" jaisi distance dikhti thi jo
            // completely bani hui thi. Ab null — distance calculator khud "N/A"
            // dega aur UI honestly "Distance unavailable" dikhayega.
            lat: doc.latitude ?? null,
            lng: doc.longitude ?? null,
            rating: doc.average_rating || null, 
            total_reviews: doc.total_reviews || 0,
            experience: doc.experience, 
            // BUG FIX: fake 'Prime Skin Care Clinic' fallback hata diya
            hospital: doc.hospital ?? null,
            // BUG FIX: fake '+923000000000' fallback hata diya — ye number
            // EmergencySuccessScreen ke "Call Clinic" button mein CRITICAL
            // patient ko dial karwata tha jaise wo asli clinic ho.
            phone: doc.phone ?? null,
            // BUG FIX: fake 'Mon-Fri 10AM-6PM' schedule fallback hata diya —
            // isi list ke baaki fields (hospital, phone, fees, coordinates)
            // ke liye ye exact same fake-fallback bug pehle explicitly fix ki
            // gayi thi, sirf schedule wala case reh gaya tha. Doctor ne agar
            // apni availability set hi nahi ki, backend null bhejta hai — ab
            // hum wahi honestly aage bhejte hain, ek ghadha hua "Available"
            // schedule nahi jo patient ko galat safe feel karwata ho jabke
            // asal slots khali hain.
            schedule: doc.schedule ?? null,
            fees: {
              // BUG FIX: fake 2000 PKR / derived USD default hata diya — doctor
              // ne fee set hi nahi ki to "Fee not set" dikhna chahiye, ek
              // specific-lagta hua fabricated amount nahi.
              pkr: doc.fees?.pkr ?? doc.fees_pkr ?? null,
              usd: doc.fees?.usd ?? doc.fees_usd ?? null,
              duration: doc.fees?.duration || "45min" 
            }
          }));

          setDoctors(enrichedDoctors);

          if (doctorIdState) {
            const target = enrichedDoctors.find(d => d.id === parseInt(doctorIdState));
            if (target) {
              setSelectedDoctor(target);
              setTimeout(() => { if (markerRefs.current[doctorIdState]) markerRefs.current[doctorIdState].openPopup(); }, 1200);
            }
          }
        } else { showNotification('error', 'Error', resData.error || 'Could not fetch specialists.'); }
      } catch (err) {
        showNotification('error', 'Network Error', 'Could not connect to the directory.');
      } finally { setLoading(false); }
    };
    initData();
  }, [doctorIdState, API_BASE_URL, scanId]);

  const handleInitiateReport = (doctorId, doctorName, doctorPhone) => {
    if (!scanId) return showNotification('warning', 'Scan Required', 'Please complete a scan first.');
    if (hasSentReport) return showNotification('warning', 'Already Sent', 'You can only send one report per scan session.');
    
    setPendingReportData({ id: doctorId, name: doctorName, phone: doctorPhone });
    setShowQuestionnaire(true);
  };

  const executeSendReport = async (answers = null) => {
    setShowQuestionnaire(false);
    if (!pendingReportData) return;
    const { id, name, phone } = pendingReportData;
    setSendingReportId(id);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/send_report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ doctor_id: id, scan_id: scanId, answers })
      });
      const data = await response.json();

      if (data.success || response.ok) { 
        // Backend wraps the real payload under `data.data` (see generate_response
        // in app.py) -- reading data.severity directly is always undefined,
        // which silently falls back to ROUTINE every time. Also carrying
        // doctorId/scanId through so the "Book Immediately" button knows
        // which doctor + scan to book against.
        const result = data.data || {};
        const successData = { 
          name, 
          phone, 
          doctorId: id,
          scanId,
          disease: diseaseState || 'AI Evaluation',
          severity: result.severity_level || 'ROUTINE', 
          duration: result.duration || '24-48 hours',
          triageReasons: result.triage_reasons || []
        };
        
        setSuccessState(successData);
        localStorage.setItem(`success_state_${scanId}`, JSON.stringify(successData));
        // BUG FIX: `sent_report_<scanId>` localStorage write yahan se hata
        // diya - backend (`scan.doctor_id`) hi ab is lock ka source-of-truth
        // hai, taake reused scan_ids (DB reset ke baad) purani browser
        // history se galat locked na ho jayein.
        setHasSentReport(true); 
      } else { showNotification('error', 'Failed', data.error || 'Could not send report.'); }
    } catch (err) { showNotification('error', 'Error', 'Connection lost.'); } 
    finally { setSendingReportId(null); setPendingReportData(null); }
  };

  const handleClearSuccess = () => {
    localStorage.removeItem(`success_state_${scanId}`);
    setSuccessState(null);
  };

  // NOTE: This project's actual slot-picker ("cinema-seat" booking modal) lives
  // in a component that hasn't been shared with Claude, so this can't call it
  // directly yet. Navigating to /my-reports with this state as a bridge --
  // share that booking component and this can be wired to open it directly
  // instead of relying on the receiving page to read this state.
  const handleBookImmediate = () => {
    const { doctorId, scanId: sid, severity } = successState || {};
    handleClearSuccess();
    navigate('/my-reports', { state: { autoOpenBookingForScanId: sid, doctorId, severity } });
  };

  if (!scanId) return null; 

  if (loading || !userLocation) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 border-4 border-slate-200 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
        </div>
        <p className="mt-6 text-slate-800 font-bold tracking-widest text-sm uppercase">Mapping Specialists...</p>
      </div>
    );
  }

  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  // BUG FIX: pehle "N/A" distance (jab doctor ki location set hi nahi) parseFloat
  // se NaN ban jata tha — sort/filter mein NaN comparisons unpredictable order
  // dete hain. Ye helper unknown distance ko Infinity treat karta hai, taake
  // wo doctors list ke aakhir mein chale jayein, crash ya random order nahi.
  const distanceValue = (d) => {
    const val = parseFloat(d);
    return Number.isNaN(val) ? Infinity : val;
  };

  // Filter & Sort Logic Pipeline
  const filteredDoctors = doctors
    .filter(doc => {
      const query = searchQuery.toLowerCase();
      const spec = (doc.specialization || doc.specialty || '').toLowerCase();
      return doc.name?.toLowerCase().includes(query) || spec.includes(query) || doc.hospital?.toLowerCase().includes(query);
    })
    .map(d => ({
      ...d, distance: calculateDistance(userLocation[0], userLocation[1], d.lat, d.lng)
    }))
    .filter(d => radiusFilter === 'all' || distanceValue(d.distance) <= radiusFilter)
    // Day Filter Execution
    .filter(d => {
      if (dayFilter === 'all') return true;
      const targetDate = getTargetDateFromDayStr(dayFilter);
      return isDoctorAvailableOnDay(d.schedule, targetDate);
    })
    .sort((a, b) => {
      if (sortBy === 'rating') {
        const ratingDiff = (b.rating || 0) - (a.rating || 0);
        return ratingDiff !== 0 ? ratingDiff : distanceValue(a.distance) - distanceValue(b.distance);
      }
      if (sortBy === 'availability') {
        const aScore = isDoctorAvailableOnDay(a.schedule, today) ? 2 : (isDoctorAvailableOnDay(a.schedule, tomorrow) ? 1 : 0);
        const bScore = isDoctorAvailableOnDay(b.schedule, today) ? 2 : (isDoctorAvailableOnDay(b.schedule, tomorrow) ? 1 : 0);
        if (bScore !== aScore) return bScore - aScore; 
        return distanceValue(a.distance) - distanceValue(b.distance);
      }
      return distanceValue(a.distance) - distanceValue(b.distance);
    });

  if (successState) {
    return (
      <EmergencySuccessScreen 
        doctorName={successState.name} 
        doctorPhone={successState.phone}
        disease={successState.disease}
        severity={successState.severity}
        duration={successState.duration}
        triageReasons={successState.triageReasons}
        onGoBack={handleClearSuccess} 
        // BUG FIX: yahan pehle navigate('/dashboard') tha - koi aisa route
        // is file mein kahin aur istemal hi nahi hota (grep se confirm kiya),
        // aur button khud "(Landing Page)" label + Home icon ke saath aata
        // hai. Isi component ke header ka apna "Home" button bhi navigate('/')
        // hi karta hai - to yahan bhi wahi target hona chahiye. Pehle click
        // karne pe koi wajood na rakhne wala '/dashboard' route pe chala jata
        // tha (ya blank/404), isi liye "button kaam nahi kar raha" mehsoos
        // hota tha.
        onGoHome={() => { handleClearSuccess(); navigate('/'); }} 
        onGoToHistory={() => { handleClearSuccess(); navigate('/my-reports'); }}
        onBookImmediate={handleBookImmediate}
      />
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-gray-100 font-sans">
      
      <PreReportQuestionnaireModal 
        isOpen={showQuestionnaire}
        onClose={() => setShowQuestionnaire(false)}
        doctorName={pendingReportData?.name || 'Doctor'}
        onSkip={() => executeSendReport(null)} 
        onSubmit={(answers) => executeSendReport(answers)} 
      />

      {/* Toast Notification */}
      {notification.show && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[9999] bg-slate-900 text-white px-6 py-3.5 rounded-full shadow-2xl flex items-center gap-3 animate-slideDown">
          {notification.type === 'error' ? <XCircle className="text-red-400" size={20} /> : <AlertCircle className="text-amber-400" size={20} />}
          <span className="text-sm font-semibold tracking-wide">{notification.message}</span>
        </div>
      )}

      {/* FULL SCREEN GOOGLE MAP */}
      <div className="absolute inset-0 z-0">
        <MapContainer center={userLocation} zoom={13} className="w-full h-full" zoomControl={false}>
          <TileLayer 
            url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}" 
            attribution="Google Maps" 
          />
          <FixMapDisplay />
          <RecenterAutomatically lat={selectedDoctor?.lat} lng={selectedDoctor?.lng} zoom={15} />

          {userLocation && (
            <Marker position={userLocation} icon={userIcon}>
              <Popup className="sleek-popup"><div className="font-bold text-slate-800 py-1 px-1">You are here</div></Popup>
            </Marker>
          )}

          {filteredDoctors.map((doc) => {
            const isTarget = parseInt(doctorIdState) === doc.id;
            return (
              <Marker
                key={doc.id}
                position={[doc.lat, doc.lng]}
                icon={isTarget ? invitedDoctorIcon : normalDoctorIcon}
                ref={(el) => { if (el) markerRefs.current[doc.id] = el; }}
                eventHandlers={{ click: () => setSelectedDoctor(doc) }}
              >
                <Popup className="sleek-popup">
                  <div className="p-2 min-w-[180px] text-left">
                    <div className="flex justify-between items-start gap-2 m-0 mb-1">
                      <p className="font-extrabold text-slate-900 text-sm m-0 leading-tight tracking-tight">
                        {formatDoctorName(doc.name)}
                      </p>
                      {doc.total_reviews > 0 ? (
                        <div className="flex items-center gap-1 bg-amber-100/80 px-1.5 py-0.5 rounded shrink-0">
                          <Star size={10} className="text-amber-500 fill-amber-500" />
                          <span className="text-[10px] font-bold text-amber-700">{Number(doc.rating).toFixed(1)}</span>
                        </div>
                      ) : (
                        <span className="bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded text-[9px] font-extrabold tracking-wide uppercase shrink-0 border border-emerald-100">
                          Fresh / New
                        </span>
                      )}
                    </div>
                    
                    <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mt-0.5 mb-1 flex items-center gap-1 flex-wrap">
                      <Stethoscope size={10} />
                      {formatSpecialization(doc.specialization || doc.specialty)}
                      <VerificationBadge status={doc.verification_status} />
                    </p>
                    {doc.experience && (
                      <p className="text-[10px] text-indigo-600 font-semibold m-0 mb-1.5 flex items-center gap-0.5">
                        <Award size={10} />
                        {formatExperience(doc.experience)}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 m-0 mb-3 font-medium flex items-center gap-1">
                      <MapPin size={11} className="text-slate-400 shrink-0" />
                      <span className="truncate">{formatHospitalName(doc.hospital)}</span>
                    </p>
                    <div className="flex gap-1.5 pt-1.5 border-t border-slate-100 items-center">
                       <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md text-[10px] font-bold border border-emerald-200/50">
                         Rs {Number(doc.fees?.pkr || 0).toLocaleString()}
                       </span>
                       <span className="bg-slate-900 text-white px-2 py-0.5 rounded-md text-[10px] font-bold shadow-sm">
                         ${doc.fees?.usd || 0}
                       </span>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* FLOATING GLASS SIDEBAR */}
      <div className="absolute inset-y-0 left-0 w-full md:w-[460px] z-[1000] p-4 pointer-events-none flex flex-col">
        <div className="flex-1 flex flex-col bg-white/80 backdrop-blur-3xl rounded-[2rem] shadow-[0_10px_50px_rgba(0,0,0,0.2)] border border-white/50 overflow-hidden pointer-events-auto">
          
          {/* Header & Filters */}
          <div className="p-6 pb-4 bg-gradient-to-b from-white/90 to-transparent">
            <div className="flex items-center justify-between mb-5">
              <button onClick={() => navigate(-1)} className="w-10 h-10 flex items-center justify-center bg-white hover:bg-slate-50 text-slate-700 rounded-full shadow-sm border border-slate-200 transition-all active:scale-90 shrink-0">
                <ArrowLeft size={18} />
              </button>
              <h1 className="text-lg font-black text-slate-800 tracking-tight flex-1 ml-4 truncate">Directory</h1>
              
              <div className="flex items-center gap-2">
                <button onClick={() => navigate('/my-reports')} className="flex items-center gap-1.5 px-3 h-10 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-full text-sm font-bold shadow-sm transition-all active:scale-95">
                  <User size={16} /> <span className="hidden sm:inline">Profile</span>
                </button>
                <button onClick={() => navigate('/')} className="flex items-center gap-1.5 px-4 h-10 bg-slate-900 hover:bg-black text-white rounded-full text-sm font-bold shadow-md shadow-slate-900/20 transition-all active:scale-95">
                  <LayoutDashboard size={16} /> <span className="hidden sm:inline">Home</span>
                </button>
              </div>
            </div>

            <div className="relative group mb-3">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <Search className="text-slate-400 group-focus-within:text-blue-500 transition-colors" size={18} />
              </div>
              <input
                type="text"
                placeholder="Find specialists, clinics..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm font-medium focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all shadow-sm"
              />
            </div>

            {/* Radius, Sort, and Day Filters container */}
            <div className="space-y-2">
              {/* Radius filter */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider shrink-0 w-10">Within</span>
                {[5, 10, 25, 'all'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRadiusFilter(r)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all border ${
                      radiusFilter === r ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {r === 'all' ? 'All' : `${r} km`}
                  </button>
                ))}
              </div>

              {/* Sort Filter */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider shrink-0 w-10">Sort</span>
                {[
                  { key: 'distance', label: 'Nearest' },
                  { key: 'rating', label: 'Top Rated' },
                  { key: 'availability', label: 'Available' }
                ].map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setSortBy(s.key)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all border ${
                      sortBy === s.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Dynamic Day-of-Week Filter Bar */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar pt-0.5 border-t border-slate-100">
                <span className="text-[10px] font-black text-blue-500 uppercase tracking-wider shrink-0 w-10">Days</span>
                {[
                  { key: 'all', label: 'All Days' },
                  { key: 'mon', label: 'Mon' },
                  { key: 'tue', label: 'Tue' },
                  { key: 'wed', label: 'Wed' },
                  { key: 'thu', label: 'Thu' },
                  { key: 'fri', label: 'Fri' },
                  { key: 'sat', label: 'Sat' },
                  { key: 'sun', label: 'Sun' }
                ].map((dayObj) => (
                  <button
                    key={dayObj.key}
                    onClick={() => setDayFilter(dayObj.key)}
                    className={`shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-extrabold uppercase tracking-wide transition-all border ${
                      dayFilter === dayObj.key
                        ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-blue-500/10'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {dayObj.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Cards List */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 custom-scrollbar">
            {filteredDoctors.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3 px-6 text-center">
                <Search size={32} opacity={0.5} />
                <p className="font-medium">No active specialists found for this selection</p>
                <button onClick={() => { setDayFilter('all'); setRadiusFilter('all'); }} className="text-xs font-bold text-blue-600 hover:text-blue-700">
                  Reset All Filters
                </button>
              </div>
            ) : (
              filteredDoctors.map((doc, idx) => {
                const isSelected = selectedDoctor?.id === doc.id;
                const isTarget = parseInt(doctorIdState) === doc.id;

                const prettyName = formatDoctorName(doc.name);
                const prettySpec = formatSpecialization(doc.specialization || doc.specialty);
                const prettyHosp = formatHospitalName(doc.hospital);
                const prettyExp = formatExperience(doc.experience);
                const initials = prettyName.replace("Dr. ", "").substring(0, 2).toUpperCase();

                const isAvailableToday = isDoctorAvailableOnDay(doc.schedule, today);
                const isAvailableTomorrow = isDoctorAvailableOnDay(doc.schedule, tomorrow);

                return (
                  <div
                    key={doc.id}
                    onClick={() => { setSelectedDoctor(doc); if (markerRefs.current[doc.id]) markerRefs.current[doc.id].openPopup(); }}
                    className={`group relative p-4 rounded-2xl cursor-pointer transition-all duration-400 ease-out border-2 animate-fade-in-up
                      ${isSelected 
                        ? 'bg-white border-blue-500 shadow-[0_10px_30px_rgba(59,130,246,0.15)] scale-[1.02]' 
                        : 'bg-white/60 hover:bg-white border-transparent hover:border-slate-200'
                      }`}
                    style={{ animationDelay: `${idx * 0.05}s`, animationFillMode: 'both' }}
                  >
                    {isTarget && !isSelected && (
                      <div className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
                    )}

                    <div className="flex gap-4 items-start">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-lg shrink-0 overflow-hidden ${
                        isSelected ? 'shadow-lg shadow-blue-500/30' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {doc.profile_image ? (
                          <img 
                            src={`${API_BASE_URL}${doc.profile_image.startsWith('/') ? doc.profile_image : '/' + doc.profile_image}`} 
                            alt={prettyName} className="w-full h-full object-cover"
                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://via.placeholder.com/150'; }} 
                          />
                        ) : (
                          <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${isSelected ? 'from-blue-500 to-indigo-600 text-white' : 'from-slate-100 to-slate-200 text-slate-600'}`}>
                            {initials}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-1 gap-2">
                          <h3 className="font-bold text-slate-900 text-base truncate tracking-tight">{prettyName}</h3>
                          {doc.total_reviews > 0 ? (
                            <div className="flex items-center gap-1 bg-amber-100/80 px-2 py-0.5 rounded-md shrink-0">
                              <Star size={12} className="text-amber-500 fill-amber-500" />
                              <span className="text-xs font-bold text-amber-700">{Number(doc.rating).toFixed(1)}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-0.5 bg-emerald-50 border border-emerald-100/70 px-2 py-0.5 rounded-md shrink-0">
                              <Sparkles size={11} className="text-emerald-500" />
                              <span className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">New</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-y-1 gap-x-1.5 mb-1.5">
                          <p className="text-xs font-bold text-blue-600 uppercase tracking-wide flex items-center gap-1">
                            <Stethoscope size={12} /> {prettySpec}
                          </p>
                          {prettyExp && (
                            <>
                              <span className="text-slate-300 text-xs">•</span>
                              <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-0.5">
                                <Award size={10} className="text-indigo-500" /> {prettyExp}
                              </span>
                            </>
                          )}
                          <VerificationBadge status={doc.verification_status} />
                        </div>
                        
                        <div className="flex items-center gap-1 text-[13px] text-slate-500 font-medium truncate">
                          <MapPin size={13} className="text-slate-400 shrink-0" />
                          {prettyHosp ? (
                            <span className="truncate">{prettyHosp}</span>
                          ) : (
                            <span className="truncate italic text-slate-400">Clinic details not added</span>
                          )}
                          <span className="mx-1 text-slate-300">•</span>
                          {doc.distance && doc.distance !== 'N/A' ? (
                            <span className="text-slate-700 font-bold">{doc.distance} km</span>
                          ) : (
                            <span className="text-slate-400 italic">Distance unavailable</span>
                          )}
                        </div>

                        {doc.verification_status !== 'approved' && (
                          <p className="mt-1 text-[10px] text-amber-600 font-medium">
                            This doctor's license is still under admin review.
                          </p>
                        )}

                        {/* Real-time Status indicators */}
                        <div className="mt-2.5 flex items-center gap-1.5">
                          {isAvailableToday ? (
                            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2.5 py-0.5 rounded-md border border-emerald-200 uppercase tracking-wider">
                              Available Today
                            </span>
                          ) : isAvailableTomorrow ? (
                            <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2.5 py-0.5 rounded-md border border-amber-200 uppercase tracking-wider">
                              Available Tomorrow
                            </span>
                          ) : (
                            <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-2.5 py-0.5 rounded-md border border-slate-200 uppercase tracking-wider">
                              Check Next Slots
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                       {doc.fees?.pkr != null ? (
                         <div className="flex items-center bg-emerald-50 border border-emerald-200/60 px-3 py-1.5 rounded-xl">
                            <span className="text-[11px] font-black text-emerald-700">PKR {Number(doc.fees.pkr).toLocaleString()}</span>
                         </div>
                       ) : (
                         <div className="flex items-center bg-slate-100 border border-slate-200/80 px-3 py-1.5 rounded-xl">
                            <span className="text-[11px] font-bold text-slate-400 italic">Fee not set</span>
                         </div>
                       )}
                       {doc.fees?.usd != null && (
                         <div className="flex items-center bg-slate-900 px-3 py-1.5 rounded-xl text-white">
                            <span className="text-[11px] font-black">USD {doc.fees.usd}</span>
                         </div>
                       )}
                       {doc.fees?.duration && (
                         <div className="flex items-center gap-1 bg-slate-100 border border-slate-200/80 px-3 py-1.5 rounded-xl text-slate-600 ml-auto">
                            <Clock size={12} className="text-slate-400" />
                            <span className="text-[11px] font-bold text-slate-700 uppercase">{doc.fees.duration}</span>
                         </div>
                       )}
                    </div>

                    {/* Expandable Action Content */}
                    <div className={`grid transition-all duration-400 ease-out ${isSelected ? 'grid-rows-[1fr] opacity-100 mt-5' : 'grid-rows-[0fr] opacity-0 mt-0'}`}>
                      <div className="overflow-hidden">
                        <div className="pt-4 border-t border-slate-100">
                          <div className="flex items-center gap-2 mb-3">
                            <CalendarDays size={16} className="text-slate-400" />
                            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Availability</span>
                          </div>
                          <div className="bg-slate-50 rounded-xl p-3 mb-4 space-y-2">
                            {doc.schedule && doc.schedule.length > 0 ? (
                              doc.schedule.map((dayObj, i) => {
                                const isSlotAvailable = dayObj.available !== undefined ? dayObj.available : (!dayObj.off && !dayObj.is_off);
                                return (
                                  <div key={i} className="flex justify-between items-center text-sm">
                                    <span className="font-semibold text-slate-600">{dayObj.day}</span>
                                    {isSlotAvailable ? (
                                      <span className="font-bold text-slate-800">
                                        {formatTime12h(dayObj.start)} - {formatTime12h(dayObj.end)}
                                      </span>
                                    ) : (
                                      <span className="font-bold text-slate-400">Unavailable</span>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              // BUG FIX: pehle yahan doc.schedule null hone par ek
                              // ghadha hua "Mon-Fri 10AM-6PM" fallback dikhta tha.
                              // Ab honestly bata dete hain ke doctor ne schedule
                              // set hi nahi ki - patient galat "available" samajh
                              // kar report bhej kar phir book karte waqt phasega nahi.
                              <p className="text-sm text-slate-400 italic text-center py-1">
                                Schedule not set yet
                              </p>
                            )}
                          </div>

                          <button
                            onClick={(e) => { e.stopPropagation(); handleInitiateReport(doc.id, doc.name, doc.phone); }}
                            disabled={sendingReportId !== null || hasSentReport || checkingReportStatus}
                            className={`w-full py-3.5 rounded-xl font-bold shadow-lg flex justify-center items-center gap-2 transition-all disabled:opacity-70 ${
                              hasSentReport 
                                ? 'bg-slate-200 text-slate-500 shadow-none cursor-not-allowed' 
                                : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                            }`}
                          >
                            {sendingReportId === doc.id || checkingReportStatus ? <Loader className="animate-spin" size={18} /> : hasSentReport ? <CheckCircle2 size={18} /> : <Send size={18} />}
                            {hasSentReport ? "Report Already Sent" : "Forward AI Report securely"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { height: 4px; width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up { animation: fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes slideDown {
          from { opacity: 0; transform: translate(-50%, -20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .animate-slideDown { animation: slideDown 0.3s ease-out forwards; }

        .sleek-popup .leaflet-popup-content-wrapper {
          border-radius: 1.25rem !important;
          box-shadow: 0 15px 35px -5px rgba(0, 0, 0, 0.12) !important;
          background: rgba(255, 255, 255, 0.98) !important;
        }
        .sleek-popup .leaflet-popup-content { margin: 8px 12px !important; }
        .leaflet-control-attribution { display: none !important; }
      `}} />
    </div>
  );
};

export default NearbyDoctors;