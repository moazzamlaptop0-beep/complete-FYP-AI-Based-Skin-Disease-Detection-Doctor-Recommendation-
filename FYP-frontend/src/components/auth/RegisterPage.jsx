import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  User, Mail, Lock, Eye, EyeOff, Sparkles, Stethoscope, 
  Phone, MapPin, Building, Briefcase, BadgeCheck, Search, Loader, Map, ArrowLeft,
  CheckCircle, ShieldCheck, Activity, ScanLine, Users, Navigation, AlertTriangle, AlertCircle
} from 'lucide-react'; 

// --- LEAFLET MAP IMPORTS ---
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css'; 
import L from 'leaflet';

// Leaflet Icons Fix (To prevent missing marker icons)
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Map Fix Components
const FixMapDisplay = () => {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => { map.invalidateSize(); }, 250); 
  }, [map]);
  return null;
};

const RecenterAutomatically = ({ lat, lng }) => {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], 14, { animate: true });
  }, [lat, lng, map]);
  return null;
};

const RegisterPage = () => {
  const navigate = useNavigate();
  const [role, setRole] = useState('ai_derma'); 
  const [showPassword, setShowPassword] = useState(false);

  // --- OTP & SUCCESS STATES ---
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  // ADD (missing feature -> real lockout bug): agar user OTP screen pe atka
  // reh jaye (email na aaye, 10-min window nikal jaye), pehle koi rasta nahi
  // tha naya OTP mangwane ka - na dobara register ho sakta tha, na login.
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMessage, setResendMessage] = useState(null);

  // --- CORE FORM STATES ---
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // --- DOCTOR SPECIFIC STATES ---
  const [specialty, setSpecialty] = useState('');
  const [hospital, setHospital] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [license, setLicense] = useState('');
  
  // --- LOCATION STATES ---
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [locationStatus, setLocationStatus] = useState({ message: '', type: null }); // type: 'loading' | 'success' | 'error' | null
  
  // --- MAP SEARCH STATES ---
  const [showMap, setShowMap] = useState(false);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [isSearchingMap, setIsSearchingMap] = useState(false);
  const [mapCenter, setMapCenter] = useState([31.5204, 74.3587]); // Default: Lahore

  const [terms, setTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const roles = [
    { id: 'ai_derma', label: 'AI User', icon: <Sparkles size={18} /> },
    { id: 'doctor', label: 'Doctor', icon: <Stethoscope size={18} /> },
  ];

  // Registration is a real two-stage sequence, so a numbered stepper is
  // meaningful here (not decorative) — it tells the user where they are.
  const steps = ['Account details', 'Verify email'];
  const currentStepIndex = isOtpSent ? 1 : 0;

  // --- 1. CURRENT LOCATION FETCH FUNCTION ---
  const handleGetLocation = () => {
    setLocationStatus({ message: 'Locating your clinic…', type: 'loading' });
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setLatitude(lat);
          setLongitude(lng);
          setMapCenter([lat, lng]); 
          setLocationStatus({ message: 'Location saved', type: 'success' });
          setShowMap(true); 
        },
        (error) => {
          console.error("Error getting location:", error);
          setLocationStatus({ message: "Couldn't access your location — check GPS permissions", type: 'error' });
        }
      );
    } else {
      setLocationStatus({ message: "GPS isn't supported by this browser", type: 'error' });
    }
  };

  // --- 2. SEARCH CLINIC LOCATION FUNCTION ---
  const handleMapSearch = async () => {
    if (!mapSearchQuery) return;
    setIsSearchingMap(true);
    setLocationStatus({ message: '', type: null });
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(mapSearchQuery)}`);
      const data = await res.json();
      
      if (data && data.length > 0) {
        const { lat, lon } = data[0];
        const newLat = parseFloat(lat);
        const newLng = parseFloat(lon);
        
        setMapCenter([newLat, newLng]);
        setLatitude(newLat);
        setLongitude(newLng);
        setLocationStatus({ message: 'Location found — drag the pin to fine-tune it', type: 'success' });
      } else {
        setLocationStatus({ message: 'No results — try adding the city name', type: 'error' });
      }
    } catch (err) {
      console.error("Map Search Error:", err);
      setLocationStatus({ message: "Couldn't search right now — try again", type: 'error' });
    } finally {
      setIsSearchingMap(false);
    }
  };

  // --- VALIDATION LOGIC ---
  const validateForm = () => {
    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return false;
    }

    if (role === 'doctor') {
      const phoneRegex = /^[0-9]{11}$/;
      if (!phoneRegex.test(phone)) {
        setError("Phone number must be exactly 11 digits (e.g., 03001234567).");
        return false;
      }
      if (license.trim().length < 5) {
        setError("Please enter a valid Medical License (PMDC) Number.");
        return false;
      }
      if (!latitude || !longitude) {
        const confirmLocation = window.confirm("You haven't added your clinic's map location. Do you still want to register without it?");
        if (!confirmLocation) return false;
      }
    }

    if (!terms) {
      setError("Please agree to the Terms of Service.");
      return false;
    }

    return true;
  };

  // --- REGISTER API CALL ---
  const handleRegister = async (e) => {
    e.preventDefault();
    setError(null);
    
    if (!validateForm()) return;

    setLoading(true);

    const selectedRoleLabel = roles.find(r => r.id === role).label;

    const payload = { 
      name, email, password, 
      role: selectedRoleLabel,
      specialty: role === 'doctor' ? specialty : null,
      hospital: role === 'doctor' ? hospital : null,
      city: role === 'doctor' ? city : null,
      phone: role === 'doctor' ? phone : null,
      license: role === 'doctor' ? license : null, 
      latitude: role === 'doctor' ? latitude : null,
      longitude: role === 'doctor' ? longitude : null,
    };

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // SUCCESS HONE PAR OTP SCREEN SHOW KAREIN
        setIsOtpSent(true);
        setError(null);
      } else {
        setError(data.error || "Registration failed!");
      }
    } catch (err) {
      console.error("Register Error:", err);
      setError("Server connection failed! Please check your backend.");
    } finally {
      setLoading(false);
    }
  };

  // --- OTP VERIFY API CALL ---
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp || otp.length < 4) {
      setError("Please enter a valid OTP.");
      return;
    }
    
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/verify-otp-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, otp: otp }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // OTP theek hai! Success popup dikhayen aur login par bhejen
        setShowSuccessPopup(true);
        setTimeout(() => {
          navigate('/login');
        }, 3500);
      } else {
        setError(data.error || "Invalid OTP! Please try again.");
      }
    } catch (err) {
      console.error("OTP Error:", err);
      setError("Server connection failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // Cooldown timer ticks har second (backend bhi apni taraf se same window enforce karta hai)
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // --- RESEND OTP API CALL ---
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || resendLoading) return;

    setResendLoading(true);
    setError(null);
    setResendMessage(null);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/resend-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setResendMessage("A new code has been sent to your email.");
        setResendCooldown(45);
      } else {
        setError(data.error || "Could not resend OTP. Please try again.");
      }
    } catch (err) {
      console.error("Resend OTP Error:", err);
      setError("Server connection failed. Try again.");
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white font-sans relative overflow-hidden lg:grid lg:grid-cols-[minmax(0,44%)_minmax(0,56%)]">

      {/* SUCCESS POPUP OVERLAY AND MODAL */}
      {showSuccessPopup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#081d42]/50 backdrop-blur-md animate-fadeIn">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] text-center relative overflow-hidden animate-popIn">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#0c2b5e] via-[#3fd5c2] to-[#0c2b5e]"></div>
            <div className="w-24 h-24 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner relative">
              <div className="absolute inset-0 bg-[#3fd5c2] rounded-full animate-ping opacity-20"></div>
              <CheckCircle size={48} className="text-[#3fd5c2] animate-bounce" />
            </div>
            <h3 className="font-display text-2xl font-bold text-[#0c2b5e] mb-2 tracking-tight">Verified successfully</h3>
            <p className="text-slate-500 text-sm mb-8 font-medium leading-relaxed">
              Your {role === 'doctor' ? 'doctor' : 'AI User'} account is now verified. Taking you to login...
            </p>
            <button 
              onClick={() => navigate('/login')}
              className="w-full bg-[#0c2b5e] hover:bg-[#081d42] text-white font-bold py-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 active:scale-95 flex items-center justify-center gap-2 group"
            >
              Go to login <ArrowLeft className="rotate-180 group-hover:translate-x-1 transition-transform" size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ================= LEFT: BRAND / TRUST PANEL ================= */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-[#0c2b5e] text-white px-12 py-12 xl:px-16">
        {/* Ambient gradient wash */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(63,213,194,0.16),transparent_45%),radial-gradient(circle_at_85%_85%,rgba(63,213,194,0.10),transparent_50%)]" />

        {/* Logo mark */}
        <Link to="/" className="relative z-10 flex items-center gap-3 group w-fit">
          <div className="w-10 h-10 rounded-xl bg-[#3fd5c2] flex items-center justify-center shadow-lg shadow-teal-900/30">
            <Stethoscope size={20} className="text-[#0c2b5e]" strokeWidth={2.5} />
          </div>
          <span className="font-display text-lg font-bold tracking-tight">AI Dermatologist</span>
        </Link>

        {/* Headline + signature scan visual */}
        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-[2.35rem] leading-[1.12] font-bold tracking-tight mb-4">
            Clinical-grade skin analysis, from wherever you are.
          </h1>
          <p className="text-blue-100/80 text-[15px] leading-relaxed mb-10">
            Upload a photo, get an AI-assisted read in seconds, and hand it straight to a
            licensed dermatologist for review — one continuous flow, not three different apps.
          </p>

          {/* Signature element: scanning reticle over a skin-map grid */}
          <div className="relative w-full aspect-[16/10] rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden mb-10">
            <div className="absolute inset-0 grid grid-cols-6 grid-rows-4">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className="border border-white/[0.06]" />
              ))}
            </div>
            <div className="scan-line" />
            <div className="absolute left-4 top-4 flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-teal-300/90 uppercase">
              <ScanLine size={12} /> Live analysis
            </div>
            <div className="absolute bottom-4 right-4 text-[10px] font-mono text-teal-200/70">
              98.2% confidence
            </div>
            {[
              { top: '30%', left: '38%' },
              { top: '55%', left: '58%' },
              { top: '68%', left: '30%' },
            ].map((pos, i) => (
              <span key={i} className="absolute w-2 h-2 rounded-full bg-[#3fd5c2] shadow-[0_0_0_4px_rgba(63,213,194,0.2)]" style={pos} />
            ))}
          </div>

          {/* Trust stats — concrete, tied to real product features */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                <ShieldCheck size={15} className="text-[#3fd5c2]" />
              </div>
              <p className="text-sm text-blue-100/80"><span className="text-white font-bold">PMDC-verified doctors</span> review every case that needs a second opinion.</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                <Activity size={15} className="text-[#3fd5c2]" />
              </div>
              <p className="text-sm text-blue-100/80"><span className="text-white font-bold">Automatic triage</span> flags urgent cases so they're never stuck in a queue.</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                <Users size={15} className="text-[#3fd5c2]" />
              </div>
              <p className="text-sm text-blue-100/80"><span className="text-white font-bold">Built for patients and doctors</span> alike — one account, the right dashboard.</p>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-xs text-blue-100/50">
          Your medical data is encrypted in transit and never shared without consent.
        </p>
      </aside>

      {/* ================= RIGHT: FORM ================= */}
      <div className="relative flex flex-col min-h-screen">

        {/* BACK BUTTON */}
        <button 
          onClick={() => {
            if (isOtpSent) setIsOtpSent(false); 
            else navigate(-1);
          }} 
          className="absolute top-6 left-6 md:top-8 md:left-8 z-30 flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur-md border border-slate-200 text-[#0c2b5e] font-bold rounded-full shadow-sm hover:bg-white hover:shadow-md hover:-translate-x-1 transition-all duration-300 group text-sm"
        >
          <ArrowLeft size={16} className="text-[#3fd5c2] group-hover:text-[#0c2b5e] transition-colors" />
          <span>Back</span>
        </button>

        {/* Mobile-only top accent + brand mark (desktop has the left panel instead) */}
        <div className="lg:hidden absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#0c2b5e] via-[#3fd5c2] to-[#0c2b5e]" />

        <div className="flex-1 flex items-center justify-center px-6 py-24 lg:py-16">
          <div className="w-full max-w-[460px]">

            <div className="mb-8">
              <div className="lg:hidden flex items-center gap-2.5 mb-6">
                <div className="w-9 h-9 rounded-lg bg-[#0c2b5e] flex items-center justify-center">
                  <Stethoscope size={17} className="text-[#3fd5c2]" strokeWidth={2.5} />
                </div>
                <span className="font-display text-base font-bold text-[#0c2b5e]">AI Dermatologist</span>
              </div>

              <h2 className="font-display text-[1.7rem] font-bold text-[#0c2b5e] tracking-tight mb-1.5">
                {isOtpSent ? 'Verify your email' : 'Create your account'}
              </h2>
              <p className="text-slate-500 text-[15px]">
                {isOtpSent ? `We sent a code to ${email || 'your email'}` : 'Join as a patient or a doctor in under a minute'}
              </p>
            </div>

            {/* Stepper — legitimate here: two real, ordered stages */}
            <div className="flex items-center gap-2 mb-8">
              {steps.map((label, i) => (
                <React.Fragment key={label}>
                  <div className="flex items-center gap-2">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors ${
                      i < currentStepIndex ? 'bg-[#3fd5c2] text-[#0c2b5e]' :
                      i === currentStepIndex ? 'bg-[#0c2b5e] text-white' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {i < currentStepIndex ? <CheckCircle size={12} /> : i + 1}
                    </div>
                    <span className={`text-xs font-bold ${i === currentStepIndex ? 'text-[#0c2b5e]' : 'text-slate-400'}`}>{label}</span>
                  </div>
                  {i < steps.length - 1 && <div className="flex-1 h-px bg-slate-200 mx-1" />}
                </React.Fragment>
              ))}
            </div>

            {error && (
              <div className="flex items-center justify-center gap-2 bg-red-50 text-red-600 p-3 rounded-xl mb-6 text-sm font-bold text-center border border-red-100 animate-fadeIn">
                <AlertCircle size={15} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 🚀 OTP VERIFICATION INTERFACE */}
            {isOtpSent ? (
              <div className="animate-fadeIn">
                <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
                  <ShieldCheck size={28} className="text-[#0c2b5e]" />
                </div>

                <form onSubmit={handleVerifyOtp} className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-[#0c2b5e] ml-1">Verification code</label>
                    <input 
                      type="text" 
                      required
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      placeholder="e.g. 123456"
                      className="w-full text-center tracking-[0.5em] text-2xl font-bold py-4 bg-slate-50 border border-slate-200 focus:border-[#3fd5c2] focus:bg-white rounded-2xl outline-none transition-all text-[#0c2b5e]"
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={loading}
                    className={`w-full mt-2 text-white font-bold py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-3 group
                      ${loading ? 'bg-slate-400 cursor-not-allowed' : 'bg-[#0c2b5e] hover:bg-[#081d42] active:scale-95'}`}
                  >
                    {loading ? "Verifying..." : "Verify & continue"}
                  </button>

                  {resendMessage && (
                    <p className="text-sm font-bold text-emerald-600 text-center animate-fadeIn">{resendMessage}</p>
                  )}

                  <p className="text-sm text-slate-500 text-center">
                    Didn't get the code?{' '}
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={resendLoading || resendCooldown > 0}
                      className={`font-bold underline underline-offset-2 ${
                        resendLoading || resendCooldown > 0
                          ? 'text-slate-400 cursor-not-allowed no-underline'
                          : 'text-[#0c2b5e] hover:text-[#3fd5c2]'
                      }`}
                    >
                      {resendLoading
                        ? "Sending..."
                        : resendCooldown > 0
                          ? `Resend code (${resendCooldown}s)`
                          : "Resend code"}
                    </button>
                  </p>
                </form>
              </div>
            ) : (
              
              /* 🚀 MAIN REGISTRATION FORM */
              <div className="animate-fadeIn">
                <div className="flex bg-slate-50 p-1.5 rounded-2xl mb-6">
                  {roles.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => { setRole(r.id); setError(null); }}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all duration-300 font-bold text-sm ${
                        role === r.id ? 'bg-white text-[#0c2b5e] shadow-md' : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      {r.icon}
                      <span>{r.label}</span>
                    </button>
                  ))}
                </div>

                <form onSubmit={handleRegister} className="space-y-5">
                  {/* Core Fields */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-[#0c2b5e] ml-1">Full name</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input 
                        type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe"
                        className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-transparent focus:border-[#3fd5c2] focus:bg-white rounded-2xl outline-none transition-all text-slate-800"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-[#0c2b5e] ml-1">Email address</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input 
                        type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com"
                        className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-transparent focus:border-[#3fd5c2] focus:bg-white rounded-2xl outline-none transition-all text-slate-800"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-[#0c2b5e] ml-1">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input 
                        type={showPassword ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters"
                        className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border border-transparent focus:border-[#3fd5c2] focus:bg-white rounded-2xl outline-none transition-all text-slate-800"
                      />
                      <button 
                        type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* DOCTOR SPECIFIC FIELDS */}
                  {role === 'doctor' && (
                    <div className="p-5 mt-6 bg-blue-50/50 border border-blue-100 rounded-2xl space-y-4 animate-fadeIn">
                      <h3 className="text-sm font-bold text-[#0c2b5e] flex items-center gap-2">
                        <Stethoscope size={16} /> Professional details
                      </h3>
                      
                      <div className="relative">
                        <BadgeCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input 
                          type="text" required={role === 'doctor'} value={license} onChange={(e) => setLicense(e.target.value)}
                          placeholder="PMDC / Medical License No."
                          className="w-full pl-12 pr-4 py-3 bg-white border border-blue-100 focus:border-[#3fd5c2] rounded-xl outline-none text-sm transition-all uppercase text-slate-800 font-medium"
                        />
                      </div>

                      <div className="relative">
                        <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input 
                          type="text" required={role === 'doctor'} value={specialty} onChange={(e) => setSpecialty(e.target.value)}
                          placeholder="Specialty (e.g., Dermatologist)"
                          className="w-full pl-12 pr-4 py-3 bg-white border border-blue-100 focus:border-[#3fd5c2] rounded-xl outline-none text-sm transition-all text-slate-800 font-medium"
                        />
                      </div>

                      <div className="relative">
                        <Building className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input 
                          type="text" required={role === 'doctor'} value={hospital} onChange={(e) => setHospital(e.target.value)}
                          placeholder="Clinic/Hospital Name"
                          className="w-full pl-12 pr-4 py-3 bg-white border border-blue-100 focus:border-[#3fd5c2] rounded-xl outline-none text-sm transition-all text-slate-800 font-medium"
                        />
                      </div>

                      <div className="flex gap-3">
                        <div className="relative flex-1">
                          <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                          <input 
                            type="text" required={role === 'doctor'} value={city} onChange={(e) => setCity(e.target.value)}
                            placeholder="City"
                            className="w-full pl-12 pr-4 py-3 bg-white border border-blue-100 focus:border-[#3fd5c2] rounded-xl outline-none text-sm transition-all text-slate-800 font-medium"
                          />
                        </div>
                        <div className="relative flex-1">
                          <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                          <input 
                            type="text" required={role === 'doctor'} value={phone} 
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, '');
                              if(val.length <= 11) setPhone(val);
                            }}
                            placeholder="03001234567"
                            className="w-full pl-12 pr-4 py-3 bg-white border border-blue-100 focus:border-[#3fd5c2] rounded-xl outline-none text-sm transition-all text-slate-800 font-medium"
                          />
                        </div>
                      </div>

                      {/* ADVANCED LOCATION SECTION */}
                      <div className="pt-4 border-t border-blue-100/60 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-bold text-[#0c2b5e] uppercase tracking-wide">Clinic map location</label>
                          {latitude && longitude && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                              {latitude.toFixed(4)}, {longitude.toFixed(4)}
                            </span>
                          )}
                        </div>

                        {!showMap ? (
                          <div className="grid grid-cols-2 gap-2.5">
                            <button
                              type="button" onClick={() => setShowMap(true)}
                              className="group flex flex-col items-center gap-2 py-4 px-3 rounded-2xl bg-white border border-blue-100 hover:border-[#3fd5c2] hover:shadow-md transition-all text-center"
                            >
                              <div className="w-9 h-9 rounded-xl bg-blue-50 group-hover:bg-teal-50 flex items-center justify-center transition-colors">
                                <Map size={16} className="text-[#0c2b5e]" />
                              </div>
                              <span className="text-xs font-bold text-[#0c2b5e]">Search on map</span>
                              <span className="text-[10px] text-slate-400 leading-tight">Type your clinic's address</span>
                            </button>

                            <button
                              type="button" onClick={handleGetLocation}
                              className="group flex flex-col items-center gap-2 py-4 px-3 rounded-2xl bg-white border border-blue-100 hover:border-[#3fd5c2] hover:shadow-md transition-all text-center"
                            >
                              <div className="w-9 h-9 rounded-xl bg-blue-50 group-hover:bg-teal-50 flex items-center justify-center transition-colors">
                                <Navigation size={16} className="text-[#0c2b5e]" />
                              </div>
                              <span className="text-xs font-bold text-[#0c2b5e]">Use current GPS</span>
                              <span className="text-[10px] text-slate-400 leading-tight">Detect it automatically</span>
                            </button>
                          </div>
                        ) : (
                          <div className="bg-white rounded-2xl border border-blue-100 shadow-sm overflow-hidden">
                            <div className="flex gap-2 p-2.5 border-b border-slate-100 bg-slate-50/60">
                              <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                                <input 
                                  type="text" placeholder="e.g., DHA Phase 6, Karachi" value={mapSearchQuery}
                                  onChange={(e) => setMapSearchQuery(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleMapSearch(); } }}
                                  className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-lg outline-none text-xs text-slate-800 focus:border-[#3fd5c2] transition-colors"
                                />
                              </div>
                              <button 
                                type="button" onClick={handleMapSearch} disabled={isSearchingMap}
                                className="px-3.5 bg-[#0c2b5e] text-white rounded-lg flex items-center justify-center hover:bg-[#081d42] transition-colors shrink-0 disabled:opacity-60"
                              >
                                {isSearchingMap ? <Loader size={13} className="animate-spin" /> : <Search size={13} />}
                              </button>
                            </div>

                            {/* Map Display Container */}
                            <div className="h-[190px] w-full relative z-0">
                              <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
                                <FixMapDisplay />
                                <RecenterAutomatically lat={mapCenter[0]} lng={mapCenter[1]} />
                                <TileLayer 
                                  url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}" 
                                  attribution="&copy; Google Maps" 
                                />
                                <Marker 
                                  position={latitude && longitude ? [latitude, longitude] : mapCenter} 
                                  draggable={true}
                                  eventHandlers={{
                                    dragend: (e) => {
                                      const position = e.target.getLatLng();
                                      setLatitude(position.lat);
                                      setLongitude(position.lng);
                                      setLocationStatus({ message: 'Pin adjusted manually', type: 'success' });
                                    },
                                  }}
                                >
                                  <Popup>Drag me to your exact clinic location!</Popup>
                                </Marker>
                              </MapContainer>
                            </div>

                            <div className="flex justify-between items-center px-3.5 py-2.5 bg-slate-50/60">
                              {latitude && longitude ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                                  <CheckCircle size={12} /> Coordinates set
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600">
                                  <AlertTriangle size={12} /> Drag the pin to set it
                                </span>
                              )}
                              <button 
                                type="button" onClick={() => setShowMap(false)}
                                className="text-[11px] text-blue-600 font-bold hover:underline"
                              >
                                Change method
                              </button>
                            </div>
                          </div>
                        )}

                        {locationStatus.message && (
                          <div className={`flex items-center justify-center gap-1.5 text-xs font-bold py-2 rounded-xl ${
                            locationStatus.type === 'success' ? 'text-emerald-700 bg-emerald-50' :
                            locationStatus.type === 'error' ? 'text-red-600 bg-red-50' :
                            'text-slate-500 bg-slate-50'
                          }`}>
                            {locationStatus.type === 'loading' && <Loader size={13} className="animate-spin" />}
                            {locationStatus.type === 'success' && <CheckCircle size={13} />}
                            {locationStatus.type === 'error' && <AlertCircle size={13} />}
                            <span>{locationStatus.message}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3 pt-2">
                    <input 
                      type="checkbox" id="terms" checked={terms} onChange={(e) => setTerms(e.target.checked)}
                      className="mt-1 w-4 h-4 text-[#3fd5c2] bg-slate-50 border-slate-300 rounded focus:ring-[#3fd5c2] cursor-pointer"
                    />
                    <label htmlFor="terms" className="text-sm text-slate-500 leading-tight cursor-pointer">
                      I agree to the <span className="text-[#0c2b5e] font-bold hover:underline">Terms of Service</span> and <span className="text-[#0c2b5e] font-bold hover:underline">Privacy Policy</span>.
                    </label>
                  </div>

                  <button 
                    type="submit" disabled={loading}
                    className={`w-full mt-4 text-white font-bold py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-3 group
                      ${loading ? 'bg-slate-400 cursor-not-allowed' : 'bg-[#3fd5c2] hover:bg-[#35b8a7] shadow-teal-500/30 active:scale-95'}`}
                    style={!loading ? { color: '#0c2b5e' } : undefined}
                  >
                    {loading ? "Processing..." : `Create ${role === 'doctor' ? 'doctor' : ''} account`}
                    {!loading && (
                      <div className="w-6 h-6 bg-[#0c2b5e]/10 rounded-full flex items-center justify-center group-hover:translate-x-1 transition-transform">
                        →
                      </div>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* Login Link - Only show if not on OTP screen */}
            {!isOtpSent && (
              <div className="mt-8 pt-6 border-t border-slate-100 text-center">
                <p className="text-sm text-slate-500">
                  Already have an account?{' '}
                  <Link to="/login" className="text-[#0c2b5e] font-bold hover:underline">
                    Log in
                  </Link>
                </p>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* 🚀 FONTS + CSS ANIMATIONS */}
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap');
        .font-display { font-family: 'Space Grotesk', sans-serif; }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.4s ease-out forwards; }
        
        @keyframes popIn { 
          0% { opacity: 0; transform: scale(0.8) translateY(20px); } 
          100% { opacity: 1; transform: scale(1) translateY(0); } 
        }
        .animate-popIn { animation: popIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

        .scan-line {
          position: absolute;
          left: 0; right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, #3fd5c2, transparent);
          box-shadow: 0 0 12px 2px rgba(63, 213, 194, 0.6);
          animation: scanSweep 3.2s ease-in-out infinite;
        }
        @keyframes scanSweep {
          0%, 100% { top: 8%; opacity: 0.9; }
          50% { top: 88%; opacity: 0.5; }
        }

        @media (prefers-reduced-motion: reduce) {
          .scan-line { animation: none; top: 45%; }
          .animate-fadeIn, .animate-popIn { animation: none; }
        }
      `}} />
    </div>
  );
};

export default RegisterPage;