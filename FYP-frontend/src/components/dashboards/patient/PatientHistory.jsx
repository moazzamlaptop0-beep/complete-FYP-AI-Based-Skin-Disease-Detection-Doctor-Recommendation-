// src/components/PatientHistory.jsx
import React, { useEffect, useState, useRef } from 'react';
import { 
  FileText, Clock, CheckCircle, AlertCircle, 
  User, Mail, ShieldCheck, Calendar, Activity, Loader, Camera,
  X, CalendarDays, Star, LayoutList, CheckCircle2, XCircle
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import PatientRatingModal from './PatientRatingModal';

const API_BASE_URL = import.meta.env.VITE_API_URL;

// ===================== HELPER FUNCTIONS =====================
const format12HourTime = (timeStr) => {
  if (!timeStr) return "—";
  const [hourString, minute] = timeStr.split(':');
  let hour = parseInt(hourString, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${ampm}`;
};

const formatDuration = (duration) => {
  if (!duration) return null;
  const str = String(duration).trim();
  if (!str) return null;
  const match = str.match(/^(\d+)\s*min/i);
  return match ? `${match[1]} min` : str;
};

const getSafeImageUrl = (path) => {
  if (!path) return '';
  const base = API_BASE_URL.replace(/\/$/, '');
  const safePath = path.replace(/^\//, '');
  return `${base}/${safePath}`;
};

// Severity ke liye chhota badge config - ROUTINE ke liye badge nahi dikhate
// (clutter avoid karne ke liye), sirf URGENT/CRITICAL highlight hote hain.
const getSeverityConfig = (severity) => {
  if (severity === 'CRITICAL') return { label: 'CRITICAL', className: 'bg-red-50 text-red-700 border-red-200' };
  if (severity === 'URGENT') return { label: 'URGENT', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  return null;
};

// ===================== SLOT PICKER MODAL =====================
const SlotPickerModal = ({ scan, onClose, showToast, onBookingSuccess }) => {
  const navigate = useNavigate();
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FULL_DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  // Severity scan/appointment se aati hai (backend-verified) - ye hi decide
  // karti hai ke ye patient already-booked slot pick kar sakta hai ya nahi.
  // Patient khud "main urgent hun" bol kar ye override nahi utha sakta.
  const severity = scan.severity || scan.severity_level || 'ROUTINE';
  const canOverrideBookedSlot = severity === 'CRITICAL' || severity === 'URGENT';
  const severityConfig = getSeverityConfig(severity);

  const [selectedDateIndex, setSelectedDateIndex] = useState(0);
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [isBooking, setIsBooking] = useState(false);
  const [bookedSlot, setBookedSlot] = useState(null);
  const [isPendingConflict, setIsPendingConflict] = useState(false);
  
  const [doctorSchedule, setDoctorSchedule] = useState([]);
  const [loadingSchedule, setLoadingSchedule] = useState(true);

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem('user')) || null;
    } catch (e) {
      return null;
    }
  })();

  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  const selectedDate = dates[selectedDateIndex];
  const selectedDayName = FULL_DAYS[selectedDate.getDay()];
  
  const yyyy = selectedDate.getFullYear();
  const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
  const dd = String(selectedDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const handleAuthFailure = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    navigate('/login');
  };

  useEffect(() => {
    const fetchSchedule = async () => {
      setLoadingSchedule(true);
      const token = localStorage.getItem('token');
      if (!token) return handleAuthFailure();

      try {
        const res = await fetch(`${API_BASE_URL}/api/doctor-availability/${scan.doctor_id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 403) return handleAuthFailure();
        if (res.ok) {
          const json = await res.json();
          setDoctorSchedule(json.data || []);
        } else {
          showToast('Failed to load doctor schedule', 'error');
        }
      } catch (e) {
        showToast('Network error while loading schedule', 'error');
      } finally {
        setLoadingSchedule(false);
      }
    };
    if (scan.doctor_id) fetchSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.doctor_id]);

  // FIX 1: Safe slots fetching logic with array validation fallback
  useEffect(() => {
    const fetchSlots = async () => {
      setLoadingSlots(true);
      setSelectedSlot(null);
      const token = localStorage.getItem('token');
      if (!token) return handleAuthFailure();

      try {
        const res = await fetch(
          `${API_BASE_URL}/api/slots/${scan.doctor_id}?date=${dateStr}`, {
              headers: { 'Authorization': `Bearer ${token}` }
          }
        );
        if (res.status === 401 || res.status === 403) return handleAuthFailure();
        if (res.ok) {
          const resData = await res.json();
          const safeSlots = Array.isArray(resData) ? resData : (resData.slots || resData.data || []);
          setSlots(safeSlots);
        } else {
          setSlots([]);
        }
      } catch (e) {
        setSlots([]);
        showToast('Error loading slots for selected date', 'error');
      } finally {
        setLoadingSlots(false);
      }
    };
    if (scan.doctor_id) fetchSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.doctor_id, dateStr]);

  const isDayOff = () => {
    const dayData = doctorSchedule.find(d => d.day === selectedDayName);
    return dayData ? dayData.off : true;
  };

  const handleBook = async () => {
    if (!selectedSlot || !user) return;
    setIsBooking(true);
    const token = localStorage.getItem('token');
    if (!token) return handleAuthFailure();

    try {
      const res = await fetch(`${API_BASE_URL}/api/book-slot`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          doctor_id: scan.doctor_id,
          patient_id: user.id,
          scan_id: scan.id,
          appointment_id: scan.appointment_id || undefined, // Set only for "Book Again" (rebooking a Cancelled appointment)
          slot_date: dateStr,
          slot_time: selectedSlot,
        }),
      });

      if (res.status === 401 || res.status === 403) return handleAuthFailure();

      if (res.ok) {
        const resData = await res.json().catch(() => ({}));
        const bookingStatus = resData?.data?.status; // "Pending-Conflict" agar slot pe conflict bana ho

        setBookedSlot(selectedSlot);
        setIsPendingConflict(bookingStatus === 'Pending-Conflict');
        setSelectedSlot(null);

        if (bookingStatus === 'Pending-Conflict') {
          showToast(resData.message || 'Slot busy tha, lekin aapka case urgent flag hua hai - doctor confirm karega.', 'warning');
        } else {
          showToast('Appointment Booked Successfully!', 'success');
        }
        
        // Parent component ka data auto-refresh karne ke liye
        if (onBookingSuccess) onBookingSuccess();

        const refreshed = await fetch(
          `${API_BASE_URL}/api/slots/${scan.doctor_id}?date=${dateStr}`, {
              headers: { 'Authorization': `Bearer ${token}` }
          }
        );
        // FIX 2: Refresh action with safe object wrapper logic check
        if (refreshed.ok) {
          const refreshedData = await refreshed.json();
          const safeSlots = Array.isArray(refreshedData) ? refreshedData : (refreshedData.slots || refreshedData.data || []);
          setSlots(safeSlots);
        }
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to book appointment', 'error');
      }
    } catch (e) {
      showToast('Booking failed due to a server error', 'error');
    } finally {
      setIsBooking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(12,43,94,0.45)', backdropFilter: 'blur(8px)' }}>
      <div className="bg-white w-full max-w-xl rounded-[2rem] shadow-2xl overflow-hidden animate-zoomIn">
        {/* Header */}
        <div className="px-8 pt-8 pb-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-2xl font-black text-[#0c2b5e] tracking-tight">Book Appointment</h2>
              {severityConfig && (
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase border ${severityConfig.className}`}>
                  {severityConfig.label}
                </span>
              )}
            </div>
            <p className="text-slate-500 text-sm font-medium mt-1">Dr. {scan.doctor_name || 'Specialist'} · {scan.disease}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors mt-1"><X size={20} /></button>
        </div>

        <div className="px-8 py-6 space-y-6">
          {/* Date Row */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Select Date</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {dates.map((d, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedDateIndex(i)}
                  className={`flex-shrink-0 flex flex-col items-center px-3 py-2.5 rounded-2xl border-2 transition-all min-w-[56px] ${
                    i === selectedDateIndex ? 'bg-[#0c2b5e] border-[#0c2b5e] text-white' : 'bg-white border-slate-100 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className={`text-[10px] font-bold uppercase ${i === selectedDateIndex ? 'text-white/70' : 'text-slate-400'}`}>{DAYS[d.getDay()]}</span>
                  <span className="text-lg font-black leading-tight">{d.getDate()}</span>
                  <span className={`text-[10px] font-bold ${i === selectedDateIndex ? 'text-white/70' : 'text-slate-400'}`}>{MONTHS[d.getMonth()]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Slots Grid */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{selectedDayName}, {selectedDate.getDate()} {MONTHS[selectedDate.getMonth()]}</p>
            {canOverrideBookedSlot && (
              <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5 items-start">
                <AlertCircle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-800 font-semibold leading-relaxed">
                  Aapka case {severity} flag hua hai — agar koi slot pehle se booked bhi ho, aap use select kar sakte hain. Doctor final priority confirm karega.
                </p>
              </div>
            )}
            {loadingSchedule ? (
              <div className="flex items-center justify-center py-10"><Loader size={24} className="animate-spin text-[#3fd5c2]" /></div>
            ) : isDayOff() ? (
              <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <CalendarDays size={28} className="text-slate-300 mx-auto mb-2" />
                <p className="text-slate-400 font-bold text-sm">Doctor is off on {selectedDayName}</p>
              </div>
            ) : loadingSlots ? (
              <div className="flex items-center justify-center py-10"><Loader size={24} className="animate-spin text-[#3fd5c2]" /></div>
            // FIX 3: Robust array condition handling before invoking .map()
            ) : (!Array.isArray(slots) || slots.length === 0) ? (
              <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <p className="text-slate-400 font-bold text-sm">No slots configured for this day.</p>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2.5">
                {slots.map((slot) => {
                  const isBooked = slot.status === 'booked';
                  const isOverridable = isBooked && canOverrideBookedSlot;
                  const isDisabled = isBooked && !canOverrideBookedSlot;
                  const isSelected = selectedSlot === slot.time;
                  const formattedTime = format12HourTime(slot.time);
                  
                  let durationText = 'Slot';
                  if (slot.duration !== undefined && slot.duration !== null) {
                    const durationStr = String(slot.duration).trim();
                    if (durationStr !== '') {
                      const numericMatch = durationStr.match(/^(\d+)\s*min/i);
                      if (numericMatch) {
                        durationText = `Slot • ${numericMatch[1]} min`;
                      } else if (!isNaN(durationStr)) {
                        durationText = `Slot • ${durationStr} min`;
                      } else {
                        durationText = `Slot • ${durationStr}`;
                      }
                    }
                  }

                  return (
                    <button
                      key={slot.time}
                      disabled={isDisabled}
                      onClick={() => setSelectedSlot(isSelected ? null : slot.time)}
                      className={`py-3 px-2 rounded-xl text-center text-[11px] font-black border-2 transition-all ${
                        isDisabled ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed line-through' :
                        isSelected ? 'bg-[#0c2b5e] border-[#0c2b5e] text-white scale-105' :
                        isOverridable ? 'bg-amber-50 border-amber-400 text-amber-700 hover:scale-105 active:scale-95' :
                        'bg-[#E1F5EE] border-[#5DCAA5] text-[#0F6E56] hover:scale-105 active:scale-95'
                      }`}
                    >
                      {formattedTime}
                      {isDisabled ? (
                        <>
                          <div className="text-[9px] font-bold mt-0.5 text-slate-300">Booked</div>
                          <div className="text-[9px] font-bold opacity-0" aria-hidden="true">&nbsp;</div>
                        </>
                      ) : isOverridable ? (
                        <>
                          <div className={`text-[9px] font-bold mt-0.5 ${isSelected ? 'text-white/70' : 'text-amber-600'}`}>Booked</div>
                          <div className={`text-[9px] font-bold ${isSelected ? 'text-white/70' : 'text-amber-600'}`}>Request Priority</div>
                        </>
                      ) : (
                        <>
                          <div className={`text-[9px] font-bold mt-0.5 ${isSelected ? 'text-white/70' : 'text-[#1D9E75]'}`}>{durationText}</div>
                          <div className={`text-[9px] font-bold ${isSelected ? 'text-white/70' : 'text-[#1D9E75]'}`}>Available</div>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {bookedSlot && isPendingConflict && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 animate-fadeIn">
              <AlertCircle size={20} className="text-amber-500 flex-shrink-0" />
              <div>
                <p className="text-amber-800 font-black text-sm">Priority Request Sent</p>
                <p className="text-amber-700 text-[11px] font-medium mt-0.5">
                  {format12HourTime(bookedSlot)} on {selectedDate.getDate()} {MONTHS[selectedDate.getMonth()]} was already booked. Doctor will confirm final priority shortly.
                </p>
              </div>
            </div>
          )}

          {bookedSlot && !isPendingConflict && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3 animate-fadeIn">
              <CheckCircle size={20} className="text-emerald-500 flex-shrink-0" />
              <div>
                <p className="text-emerald-800 font-black text-sm">Appointment Confirmed!</p>
                <p className="text-emerald-600 text-[11px] font-medium mt-0.5">{format12HourTime(bookedSlot)} on {selectedDate.getDate()} {MONTHS[selectedDate.getMonth()]} with Dr. {scan.doctor_name}</p>
              </div>
            </div>
          )}

          {!bookedSlot && (
            <button
              onClick={handleBook}
              disabled={!selectedSlot || isBooking}
              className={`w-full py-4 rounded-2xl font-black text-base transition-all active:scale-95 ${
                selectedSlot && !isBooking ? 'bg-[#3fd5c2] text-[#0c2b5e] hover:bg-[#34bda9] shadow-lg shadow-[#3fd5c2]/20' : 'bg-slate-100 text-slate-300 cursor-not-allowed'
              }`}
            >
              {isBooking ? <span className="flex items-center justify-center gap-2"><Loader size={16} className="animate-spin" /> Booking...</span> : selectedSlot ? `Confirm — ${format12HourTime(selectedSlot)} slot` : 'Select a time slot'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ===================== MAIN COMPONENT =====================
const PatientHistory = () => {
    const navigate = useNavigate();
    const location = useLocation();
    
    // Core States
    const [scans, setScans] = useState([]);
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    // Refresh/pull-to-refresh par bhi wahi tab (Scans ya Appointments) khula
    // rahe - session ke andar activeTab yaad rakhte hain.
    const [activeTab, setActiveTabRaw] = useState(() => {
        try { return sessionStorage.getItem('patientDashboardActiveTab') || 'scans'; }
        catch (e) { return 'scans'; }
    });
    const setActiveTab = (tab) => {
        setActiveTabRaw(tab);
        try { sessionStorage.setItem('patientDashboardActiveTab', tab); } catch (e) { /* ignore */ }
    };
    
    // Modal & UI States
    const [downloadingId, setDownloadingId] = useState(null);
    const [bookingScan, setBookingScan] = useState(null); 
    const [ratingScan, setRatingScan] = useState(null);
    const [toast, setToast] = useState({ show: false, message: '', type: '' });
    // Reassigned patient jab suggested slot par ek-click book kare, us button
    // ka loading state track karta hai (`${appointmentId}-${index}` format)
    const [quickBookingKey, setQuickBookingKey] = useState(null);
    
    const [user, setUser] = useState(() => {
        try { return JSON.parse(localStorage.getItem('user')) || null; } 
        catch(e) { return null; }
    });
    
    const [profileImage, setProfileImage] = useState(() => {
        return user ? localStorage.getItem(`profile_img_${user.id}`) : null;
    });

    const showToast = (message, type = 'error') => {
        setToast({ show: true, message, type });
        setTimeout(() => setToast({ show: false, message: '', type: '' }), 4000);
    };

    const handleAuthFailure = () => {
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        navigate('/login');
    };

    useEffect(() => {
        let storedUser = null;
        try { storedUser = JSON.parse(localStorage.getItem('user')); } catch (e) { storedUser = null; }
        const token = localStorage.getItem('token');
        
        if (!storedUser || !token || storedUser.role !== 'AI User') {
            handleAuthFailure();
        } else {
            setUser((prevUser) => {
              if (JSON.stringify(prevUser) !== JSON.stringify(storedUser)) return storedUser;
              return prevUser;
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate]);

    const fetchData = async () => {
        if (!user || !user.id) { setLoading(false); return; }
        const token = localStorage.getItem('token');
        if (!token) { handleAuthFailure(); return; }

        try {
            setLoading(true);
            
            // 1. Fetch Scans
            const scanRes = await fetch(`${API_BASE_URL}/patient/scans/${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (scanRes.status === 401 || scanRes.status === 403) return handleAuthFailure();
            if (scanRes.ok) { const json = await scanRes.json(); setScans(json.data || []); }
            else showToast("Could not load medical scans", "error");

            // 2. Fetch Appointments 
            const apptRes = await fetch(`${API_BASE_URL}/api/patient-appointments/${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (apptRes.ok) { const json = await apptRes.json(); setAppointments(json.data || []); }
            
        } catch (err) {
            console.error("Fetch Data Error:", err);
            showToast("Server connection error. Please try again later.", "error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, location.key]);

    // Jab EmergencySuccessScreen ke "Book a Slot Immediately" button (NearbyDoctors ->
    // handleBookImmediate) se navigate karke yahan aya ho, scan_id location.state mein
    // "autoOpenBookingForScanId" ke through aata hai - us scan ke liye seedha booking
    // modal khol dete hain (CRITICAL/URGENT patient ko turant slot dikhana hai, is liye
    // yahan invite_to_clinic flag ka wait nahi karte jaisa normal "Book Slot" button karta hai).
    // Ye hi wo bug tha jiski wajah se "immediate booking slot" kabhi nazar nahi aata tha -
    // NearbyDoctors state bhej raha tha lekin ye page kabhi padh hi nahi raha tha.
    const autoBookHandledRef = useRef(false);
    useEffect(() => {
        const autoScanId = location.state?.autoOpenBookingForScanId;
        if (!autoScanId || loading || autoBookHandledRef.current) return;

        const matchedScan = scans.find(s => s.id === autoScanId || s.scan_id === autoScanId);

        if (matchedScan) {
            autoBookHandledRef.current = true;
            setActiveTab('scans');
            setBookingScan(matchedScan);
            // Nav state clear karo taake back/refresh par dobara auto-open na ho
            navigate(location.pathname, { replace: true, state: {} });
        } else if (scans.length > 0) {
            // Scans load ho chuke hain lekin ye scan is patient ki list mein nahi mila -
            // hamesha ke liye wait karne ke bajaye stop karo aur user ko batao.
            autoBookHandledRef.current = true;
            showToast("Could not locate that scan to start booking. Please book from the list below.", "warning");
            navigate(location.pathname, { replace: true, state: {} });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scans, loading]);

    // Real-time Updates (Server-Sent Events) — jab bhi doctor side se koi
    // scan/appointment update ho, ye push aa jayegi aur state seedha update
    // ho jayega. Isse manual browser refresh ki zaroorat nahi rehti, aur
    // page kabhi reload nahi hota isliye activeTab (scans/appointments)
    // apni jagah rehta hai.
    const isFirstSseMessage = React.useRef(true);
    useEffect(() => {
        if (!user || !user.id) return;

        const sseUrl = `${API_BASE_URL}/api/patient-updates-stream/${user.id}`;
        const eventSource = new EventSource(sseUrl);

        eventSource.onmessage = (event) => {
            try {
                const updateData = JSON.parse(event.data);
                if (updateData.scans) setScans(updateData.scans);
                if (updateData.appointments) setAppointments(updateData.appointments);
                if (!isFirstSseMessage.current) {
                    showToast("Aapka dashboard update ho gaya hai.", "success");
                }
                isFirstSseMessage.current = false;
            } catch (e) {
                console.error("Error parsing real-time push payload", e);
            }
        };

        eventSource.onerror = () => {
            console.log("Patient SSE link encountered error. Browser will retry automatically.");
        };

        return () => {
            eventSource.close();
            isFirstSseMessage.current = true;
        };
    }, [user]);

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            showToast("Please select a valid image file.", "error");
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            showToast("File size exceeds 2MB limit.", "error");
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            setProfileImage(reader.result);
            if (user?.id) {
                try {
                    localStorage.setItem(`profile_img_${user.id}`, reader.result);
                } catch (error) {
                    showToast("Storage quota full. Cannot save image.", "warning");
                }
            }
        };
        reader.readAsDataURL(file);
    };

    const getConfidenceConfig = (raw) => {
        let p = parseFloat(raw) || 0;
        if (p > 0 && p <= 1) p = p * 100;
        else if (p > 100) p = p > 1000 ? p / 100 : p; 
        p = Math.min(Math.max(p, 0), 100);
        
        let colorClass = "bg-rose-500", textClass = "text-rose-600", riskLabel = "Low Confidence"; 
        if (p >= 85) { colorClass = "bg-emerald-500"; textClass = "text-emerald-600"; riskLabel = "High Confidence"; } 
        else if (p >= 50) { colorClass = "bg-amber-500"; textClass = "text-amber-600"; riskLabel = "Moderate Confidence"; }
        return { finalValue: p.toFixed(1), colorClass, textClass, riskLabel };
    };

    // Reassigned (bumped) patient auto-compensation suggestion par direct
    // click kare to full modal khole bina seedha book ho jaye - friction kam.
    const quickBookSuggested = async (appt, slot, key) => {
        if (!user) return;
        setQuickBookingKey(key);
        const token = localStorage.getItem('token');
        if (!token) return handleAuthFailure();

        try {
            const res = await fetch(`${API_BASE_URL}/api/book-slot`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    doctor_id: appt.doctor_id,
                    patient_id: user.id,
                    scan_id: appt.scan_id,
                    appointment_id: appt.id, // Reassigned row ko reuse karta hai (rebook flow)
                    slot_date: slot.date,
                    slot_time: slot.time,
                }),
            });

            if (res.status === 401 || res.status === 403) return handleAuthFailure();

            if (res.ok) {
                showToast('Appointment Booked Successfully!', 'success');
                fetchData();
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to book suggested slot', 'error');
            }
        } catch (e) {
            showToast('Booking failed due to a server error', 'error');
        } finally {
            setQuickBookingKey(null);
        }
    };

    const generatePDF = async (scan) => {
        setDownloadingId(scan.id);
        const element = document.getElementById(`pdf-report-${scan.id}`);
        
        if (!element) {
            showToast("PDF layout not found on the page.", "error");
            setDownloadingId(null);
            return;
        }
        
        element.style.display = 'block';
        try {
            await new Promise(resolve => setTimeout(resolve, 150));
            const canvas = await html2canvas(element, { scale: 2, useCORS: true, logging: false });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            
            const pdfName = user?.name ? user.name.replace(/\s+/g, '_') : 'Patient';
            pdf.save(`Medical_Report_${pdfName}_${scan.date}.pdf`);
            showToast("PDF Downloaded successfully!", "success");
        } catch (error) {
            console.error("PDF Error:", error);
            showToast("An error occurred while generating PDF.", "error");
        } finally {
            element.style.display = 'none';
            setDownloadingId(null);
        }
    };

    if (!user) return null;

    return (
        <div className="min-h-screen bg-slate-50 pt-28 pb-20 px-6 md:px-12 font-sans selection:bg-indigo-100 relative">
            
            {toast.show && (
                <div className={`fixed top-24 right-6 z-[9999] flex items-center gap-3 px-5 py-4 rounded-2xl shadow-xl animate-fadeIn ${
                    toast.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' :
                    toast.type === 'warning' ? 'bg-amber-50 border border-amber-200 text-amber-800' :
                    'bg-rose-50 border border-rose-200 text-rose-800'
                }`}>
                    {toast.type === 'success' ? <CheckCircle2 size={20} className="text-emerald-500"/> : 
                     toast.type === 'warning' ? <AlertCircle size={20} className="text-amber-500"/> :
                     <XCircle size={20} className="text-rose-500"/>}
                    <span className="font-bold text-sm">{toast.message}</span>
                </div>
            )}

            <div className="max-w-6xl mx-auto">
                {bookingScan && (
                    <SlotPickerModal 
                        scan={bookingScan} 
                        onClose={() => setBookingScan(null)} 
                        showToast={showToast} 
                        onBookingSuccess={fetchData} 
                    />
                )}
                {ratingScan && (
                    <PatientRatingModal
                        isOpen={!!ratingScan}
                        onClose={() => setRatingScan(null)}
                        targetData={ratingScan}
                        API_BASE_URL={API_BASE_URL}
                        onRatingSuccess={(newRating, newReview) => {
                            if (ratingScan.type === 'appointment') {
                                setAppointments(prevAppointments => prevAppointments.map(a =>
                                    a.id === ratingScan.appointment_id ? { ...a, patient_rating: newRating, patient_review: newReview } : a
                                ));
                            } else {
                                setScans(prevScans => prevScans.map(s =>
                                    s.id === ratingScan.id ? { ...s, patient_rating: newRating, patient_review: newReview } : s
                                ));
                            }
                            showToast("Rating submitted successfully!", "success");
                        }}
                    />
                )}

                {/* Profile Header */}
                <div className="bg-white border border-slate-200 rounded-2xl p-8 mb-8 shadow-sm relative overflow-hidden">
                    <div className="flex flex-col md:flex-row items-center gap-8 relative z-10">
                        <div className="relative">
                            <label htmlFor="profile-upload" className="relative group cursor-pointer block rounded-full">
                                <div className="w-32 h-32 bg-slate-100 rounded-full border-4 border-white shadow-md flex items-center justify-center overflow-hidden transition-transform duration-300 group-hover:scale-105">
                                    {profileImage
                                        ? <img src={profileImage} alt="Profile" className="w-full h-full object-cover" />
                                        : <div className="text-slate-300"><User size={48} /></div>
                                    }
                                </div>
                                <div className="absolute inset-0 bg-slate-900/40 rounded-full opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity duration-300 backdrop-blur-sm">
                                    <Camera size={24} className="text-white mb-1" />
                                    <span className="text-[10px] text-white font-semibold tracking-wider">UPLOAD</span>
                                </div>
                            </label>
                            <input type="file" id="profile-upload" accept="image/*" className="hidden" onChange={handleImageUpload} />
                            <div className="absolute bottom-1 right-1 bg-emerald-500 p-2 rounded-full shadow-sm border-2 border-white">
                                <ShieldCheck size={16} className="text-white" />
                            </div>
                        </div>

                        <div className="flex-1 text-center md:text-left">
                            <div className="inline-flex items-center gap-2 bg-indigo-50 px-3 py-1 rounded-full mb-3 border border-indigo-100">
                                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Patient Dashboard</span>
                            </div>
                            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 mb-2">
                                {user?.name || 'Patient'}
                            </h1>
                            <div className="flex flex-wrap justify-center md:justify-start gap-5 text-sm font-medium text-slate-500">
                                <span className="flex items-center gap-1.5"><Mail size={16} className="text-slate-400" /> {user?.email || 'N/A'}</span>
                                <span className="flex items-center gap-1.5"><Calendar size={16} className="text-slate-400" /> Joined {user?.joined_at || '2024'}</span>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-center min-w-[120px]">
                                <Activity size={24} className="text-indigo-600 mx-auto mb-2" />
                                <p className="text-3xl font-black text-slate-900">{scans.length}</p>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">Total Scans</p>
                            </div>
                            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-center min-w-[120px]">
                                <CalendarDays size={24} className="text-[#3fd5c2] mx-auto mb-2" />
                                <p className="text-3xl font-black text-slate-900">{appointments.length}</p>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">Appointments</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tabs Engine */}
                <div className="flex flex-wrap items-center gap-3 mb-8 border-b border-slate-200 pb-4">
                    <button onClick={() => setActiveTab('scans')} className={`px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${activeTab === 'scans' ? 'bg-[#0c2b5e] text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-slate-100'}`}>
                        <LayoutList size={16}/> Medical History Scans
                    </button>
                    <button onClick={() => setActiveTab('appointments')} className={`px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${activeTab === 'appointments' ? 'bg-[#3fd5c2] text-[#0c2b5e] shadow-sm' : 'bg-white text-slate-500 hover:bg-slate-100'}`}>
                        <CalendarDays size={16}/> My Appointments
                    </button>
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader className="animate-spin h-8 w-8 text-indigo-600 mb-4" />
                        <p className="text-sm font-medium text-slate-500">Retrieving your encrypted records...</p>
                    </div>
                ) : activeTab === 'scans' ? (
                    // ================= SCANS TAB ================= 
                    scans.length === 0 ? (
                        <div className="text-center py-20 bg-white border border-slate-200 rounded-[2rem] shadow-sm max-w-xl mx-auto">
                            <Activity size={48} className="text-slate-300 mx-auto mb-4 animate-pulse" />
                            <h3 className="text-xl font-bold text-slate-800">No medical history found</h3>
                            <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto px-4">
                                You haven't performed any skin scans yet. Your diagnostic reports and doctor consultations will appear here.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {scans.map((scan) => {
                                const { finalValue, colorClass, textClass, riskLabel } = getConfidenceConfig(scan.confidence);
                                const actualComment = scan.doctor_comment || scan.comment;
                                const isReviewed = Boolean(actualComment);
                                const isEligibleForRating = isReviewed && scan.status === 'Reviewed' && !scan.invite_to_clinic;

                                // Agar clinic visit recommend hui hai, "Book Slot" sirf tab dikhega jab is scan
                                // se linked koi active (non-Cancelled) appointment na ho — warna dobara booking se
                                // duplicate appointments ban jate hain.
                                const activeApptForScan = appointments.find(a => a.scan_id === scan.id && a.status !== 'Cancelled');

                                return (
                                    <div key={scan.id} className="group bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-md transition-shadow duration-300 relative">
                                        <div className="p-6">
                                            {scan.invite_to_clinic && (
                                                <div className="mb-5 bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-center gap-3 animate-fadeIn">
                                                    <div className="bg-rose-100 p-2 rounded-lg flex-shrink-0">
                                                        <AlertCircle size={18} className="text-rose-600" />
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className="text-rose-700 font-bold text-xs uppercase tracking-wide">Action Required</p>
                                                        <p className="text-rose-600/80 text-[11px] font-medium mt-0.5">
                                                            {activeApptForScan
                                                                ? `Appointment already ${activeApptForScan.status.toLowerCase()} — check the Appointments tab.`
                                                                : 'Doctor has recommended a physical examination.'}
                                                        </p>
                                                    </div>
                                                    {!activeApptForScan && (
                                                        <button
                                                            onClick={() => setBookingScan(scan)}
                                                            className="bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold px-4 py-2 rounded-lg uppercase transition-colors shadow-sm flex-shrink-0 flex items-center gap-1.5"
                                                        >
                                                            <CalendarDays size={13} /> Book Slot
                                                        </button>
                                                    )}
                                                </div>
                                            )}

                                            <div className="flex gap-6 items-start mb-6">
                                                <img
                                                    src={getSafeImageUrl(scan.image_url)}
                                                    alt="Scan"
                                                    crossOrigin="anonymous"
                                                    className="w-24 h-24 object-cover rounded-xl border border-slate-200 shadow-sm"
                                                />
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                        <Clock size={12} className="text-slate-400" />
                                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{scan.date}</span>
                                                    </div>
                                                    <h3 className="text-xl font-bold text-slate-900 mb-3 capitalize tracking-tight flex items-center gap-2">
                                                        {scan.disease}
                                                        {getSeverityConfig(scan.severity) && (
                                                            <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase border ${getSeverityConfig(scan.severity).className}`}>
                                                                {getSeverityConfig(scan.severity).label}
                                                            </span>
                                                        )}
                                                    </h3>
                                                    <div className="space-y-1.5">
                                                        <div className="flex justify-between items-end">
                                                            <span className={`text-[10px] font-bold uppercase tracking-wider ${textClass}`}>{riskLabel}</span>
                                                            <span className={`text-base font-black tracking-tight ${textClass}`}>{finalValue}%</span>
                                                        </div>
                                                        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                                            <div className={`h-full ${colorClass} rounded-full transition-all duration-1000`} style={{ width: `${finalValue}%` }} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* BUG FIX: pehle ye "Clinical Notes" card har scan ke liye unconditionally
                                                dikhta tha - chahe patient ne kabhi report kisi doctor ko bheja hi na ho
                                                (sirf scan kiya, result dekha, wapas chala gaya). Aise scans ke liye bhi
                                                "Evaluation in progress. Our specialist will review..." dikh jata tha,
                                                jo patient ko galat lagta ke unka scan kisi doctor ke paas review ke liye
                                                pending hai - jabke wo kabhi bheja hi nahi gaya. Ab ye poora block sirf
                                                tab dikhta hai jab scan.doctor_id set ho (matlab /send_report se scan
                                                actually kisi doctor ko forward hua ho). */}
                                            {scan.doctor_id && (
                                            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/60">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <Activity size={14} className="text-[#0c2b5e]" />
                                                        <span className="text-[10px] font-bold uppercase text-slate-600 tracking-wider">Clinical Notes</span>
                                                    </div>
                                                    {isReviewed && (
                                                        <span className="flex items-center gap-1 text-[10px] text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-200">
                                                            <CheckCircle size={10} /> REVIEWED
                                                        </span>
                                                    )}
                                                </div>

                                                {isReviewed && (
                                                    <div className="mb-2">
                                                        <p className="text-[11px] font-semibold text-slate-700">Dr. {scan.doctor_name || "Specialist"}</p>
                                                        {scan.doctor_email && (
                                                            <a href={`mailto:${scan.doctor_email}?subject=Question Regarding Medical Report ${scan.id}`}
                                                               className="text-[10px] text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1 mt-0.5 w-max">
                                                                <Mail size={10} /> {scan.doctor_email}
                                                            </a>
                                                        )}
                                                    </div>
                                                )}

                                                <p className="text-sm text-slate-600 leading-relaxed italic mb-4 bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                                                    {actualComment
                                                        ? `"${actualComment}"`
                                                        : "Evaluation in progress. Our specialist will review the AI findings shortly."}
                                                </p>

                                                {isReviewed && (
                                                    <div className="flex flex-col gap-2">
                                                        <button
                                                            onClick={() => generatePDF(scan)}
                                                            disabled={downloadingId === scan.id}
                                                            className="w-full py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-sm"
                                                        >
                                                            {downloadingId === scan.id ? <Loader size={14} className="animate-spin" /> : <FileText size={14} className="text-indigo-600" />}
                                                            {downloadingId === scan.id ? "GENERATING..." : "DOWNLOAD PDF"}
                                                        </button>

                                                        {isEligibleForRating && (
                                                            <button
                                                                onClick={() => setRatingScan({ ...scan, type: 'scan' })}
                                                                className={`w-full py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all border ${
                                                                    scan.patient_rating ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                                                                }`}
                                                            >
                                                                {scan.patient_rating ? (
                                                                    <>
                                                                        <div className="flex items-center gap-0.5">
                                                                            {[1, 2, 3, 4, 5].map((i) => (
                                                                                <Star key={i} size={12} className={i <= scan.patient_rating ? 'fill-amber-500 text-amber-500' : 'text-amber-200'} />
                                                                            ))}
                                                                        </div>
                                                                        EDIT YOUR RATING
                                                                    </>
                                                                ) : (
                                                                    <><Star size={14} /> RATE YOUR CONSULTATION</>
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            )}
                                        </div>

                                        {/* Hidden PDF Template */}
                                        <div id={`pdf-report-${scan.id}`} className="bg-white text-black p-12 w-[800px] absolute -left-[9999px] top-0" style={{ display: 'none' }}>
                                            <div className="border-b-4 border-indigo-900 pb-6 mb-8 flex justify-between items-center">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-12 h-12 bg-indigo-900 rounded-full flex items-center justify-center"><Activity className="text-white" size={24} /></div>
                                                    <div>
                                                        <h1 className="text-3xl font-black text-indigo-900 m-0">Derma AI Scanner</h1>
                                                        <p className="text-gray-500 text-sm font-bold uppercase tracking-widest m-0">Diagnostic Report</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-gray-800 m-0">Report ID: <span className="font-normal">{scan.id}</span></p>
                                                    <p className="font-bold text-gray-800 m-0">Date: <span className="font-normal">{scan.date}</span></p>
                                                </div>
                                            </div>
                                            <div className="bg-gray-50 p-6 rounded-xl mb-8 border border-gray-200 flex justify-between items-center">
                                                <div className="flex items-center gap-4">
                                                    {profileImage && <img src={profileImage} alt="Patient" className="w-16 h-16 rounded-full border-2 border-white shadow-sm object-cover" />}
                                                    <div>
                                                        <p className="text-xs text-gray-500 font-bold uppercase mb-1 m-0">Patient Name</p>
                                                        <p className="text-xl font-black text-indigo-900 m-0">{user?.name || 'Patient'}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs text-gray-500 font-bold uppercase mb-1 m-0">Email / Contact</p>
                                                    <p className="text-lg font-bold text-gray-800 m-0">{user?.email || 'N/A'}</p>
                                                </div>
                                            </div>
                                            <div className="mb-8 flex gap-8">
                                                <img src={getSafeImageUrl(scan.image_url)} alt="Scan" crossOrigin="anonymous" className="w-48 h-48 object-cover rounded-xl border border-gray-300 shadow-sm" />
                                                <div className="flex-1 py-4">
                                                    <p className="text-sm text-gray-500 font-bold uppercase mb-2 m-0">AI Primary Detection</p>
                                                    <h2 className="text-4xl font-black text-slate-800 capitalize mb-4 m-0">{scan.disease}</h2>
                                                    <div className="flex justify-between items-center bg-gray-100 p-4 rounded-xl border border-gray-200">
                                                        <span className="font-bold text-gray-700">AI Confidence Score:</span>
                                                        <span className="text-2xl font-black text-indigo-900">{finalValue}%</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="mb-16">
                                                <h3 className="text-xl font-black border-b-2 border-gray-200 pb-2 mb-4 text-indigo-900">Clinical Evaluation</h3>
                                                <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 min-h-[120px]">
                                                    <p className="text-gray-800 font-medium italic text-lg leading-relaxed m-0">"{actualComment}"</p>
                                                </div>
                                            </div>
                                            <div className="flex justify-between items-end mt-12 pt-8 border-t-2 border-gray-200">
                                                <div className="text-gray-500 text-xs w-1/2">
                                                    <p className="m-0 font-bold mb-1">Disclaimer:</p>
                                                    <p className="m-0">This report combines AI preliminary analysis with clinical oversight. It is not a substitute for a comprehensive physical biopsy.</p>
                                                </div>
                                                <div className="text-center">
                                                    <div className="w-48 border-b-2 border-black mb-2 mx-auto"></div>
                                                    <p className="font-bold text-gray-800 text-lg m-0">Dr. {scan.doctor_name || "Specialist"}</p>
                                                    <p className="text-sm text-gray-500 m-0">{scan.doctor_email || "Verified Clinical Team"}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )
                ) : (
                    // ================= APPOINTMENTS TAB ================= 
                    <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm">
                        {appointments.length === 0 ? (
                            <div className="text-center py-16 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                <CalendarDays size={48} className="text-slate-300 mx-auto mb-4" />
                                <h3 className="text-xl font-bold text-slate-800">No Appointments Booked</h3>
                                <p className="text-slate-500 text-sm mt-2 max-w-sm mx-auto px-4">
                                    Your scheduled sessions with specialists will appear here.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 m-0 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                                            <th className="px-6 py-4">Specialist / Doctor</th>
                                            <th className="px-6 py-4">Date & Time</th>
                                            <th className="px-6 py-4">Diagnosis Topic</th>
                                            <th className="px-6 py-4">Status</th>
                                            <th className="px-6 py-4">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {appointments.map((appt) => (
                                            <tr key={appt.id} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="px-6 py-5">
                                                    <p className="font-bold text-slate-800 text-sm">Dr. {appt.doctor_name || 'Specialist'}</p>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center gap-2">
                                                        <Clock size={14} className="text-[#3fd5c2]"/>
                                                        <div>
                                                            <p className="font-bold text-slate-800 text-sm">{format12HourTime(appt.slot_time)}</p>
                                                            <div className="flex items-center gap-1.5">
                                                                <p className="text-xs text-slate-500 font-medium">{appt.slot_date}</p>
                                                                {formatDuration(appt.duration) && (
                                                                    <span className="text-[9px] font-black text-[#0F6E56] bg-[#E1F5EE] px-1.5 py-0.5 rounded uppercase tracking-wide">{formatDuration(appt.duration)}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className="text-xs font-bold text-slate-600 capitalize bg-slate-100 px-3 py-1 rounded-md">{appt.disease || 'Consultation'}</span>
                                                        {getSeverityConfig(appt.scan_info?.severity) && (
                                                            <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase border ${getSeverityConfig(appt.scan_info?.severity).className}`}>
                                                                {getSeverityConfig(appt.scan_info?.severity).label}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <span className={`text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-wider border ${
                                                        appt.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                        appt.status === 'Cancelled' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                        appt.status === 'Pending-Conflict' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                        appt.status === 'Reassigned' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                                        'bg-indigo-50 text-indigo-700 border-indigo-200'
                                                    }`}>
                                                        {appt.status === 'Pending-Conflict' ? 'Pending Confirmation' :
                                                         appt.status === 'Reassigned' ? 'Rescheduling Needed' :
                                                         appt.status || 'Scheduled'}
                                                    </span>

                                                    {appt.status === 'Pending-Conflict' && (
                                                        <p className="text-[10px] text-amber-600 font-medium mt-1.5 max-w-[190px] leading-snug flex items-start gap-1">
                                                            <AlertCircle size={11} className="shrink-0 mt-0.5" />
                                                            A higher-priority case is contesting this slot — doctor will confirm shortly.
                                                        </p>
                                                    )}

                                                    {(appt.status === 'Cancelled' || appt.status === 'Reassigned') && appt.cancellation_reason && (
                                                        <p className="text-[10px] text-slate-400 font-medium mt-1.5 max-w-[190px] leading-snug">
                                                            Reason: {appt.cancellation_reason}
                                                        </p>
                                                    )}

                                                    {appt.status === 'Reassigned' && Array.isArray(appt.suggested_slots) && appt.suggested_slots.length > 0 && (
                                                        <div className="mt-2 flex flex-col gap-1 max-w-[190px]">
                                                            <p className="text-[9px] font-black text-orange-600 uppercase tracking-wide">Suggested slots</p>
                                                            {appt.suggested_slots.slice(0, 3).map((s, idx) => {
                                                                const key = `${appt.id}-${idx}`;
                                                                return (
                                                                    <button
                                                                        key={key}
                                                                        onClick={() => quickBookSuggested(appt, s, key)}
                                                                        disabled={quickBookingKey === key}
                                                                        className="text-[10px] font-bold text-left px-2 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 transition-all disabled:opacity-50"
                                                                    >
                                                                        {quickBookingKey === key ? 'Booking...' : `${s.date} · ${format12HourTime(s.time)}`}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center gap-1.5">
                                                        {appt.status === 'Completed' && (
                                                            <button
                                                                onClick={() => setRatingScan({
                                                                    id: appt.id,
                                                                    appointment_id: appt.id,
                                                                    doctor_id: appt.doctor_id,
                                                                    doctor_name: appt.doctor_name,
                                                                    patient_rating: appt.patient_rating,
                                                                    patient_review: appt.patient_review,
                                                                    type: 'appointment',
                                                                })}
                                                                className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all ${
                                                                    appt.patient_rating ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                                                                }`}
                                                            >
                                                                <Star size={12} className={appt.patient_rating ? 'fill-amber-500' : ''} />
                                                                {appt.patient_rating ? 'Edit Rating' : 'Rate'}
                                                            </button>
                                                        )}
                                                        {(appt.status === 'Cancelled' || appt.status === 'Reassigned') && (
                                                            <button
                                                                onClick={() => setBookingScan({
                                                                    id: appt.scan_id,
                                                                    appointment_id: appt.id,
                                                                    doctor_id: appt.doctor_id,
                                                                    doctor_name: appt.doctor_name,
                                                                    disease: appt.disease,
                                                                    severity: appt.scan_info?.severity || 'ROUTINE',
                                                                })}
                                                                className="text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg border bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200 flex items-center gap-1.5 transition-all"
                                                            >
                                                                <CalendarDays size={12} /> {appt.status === 'Reassigned' ? 'Choose Different Slot' : 'Book Again'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PatientHistory;