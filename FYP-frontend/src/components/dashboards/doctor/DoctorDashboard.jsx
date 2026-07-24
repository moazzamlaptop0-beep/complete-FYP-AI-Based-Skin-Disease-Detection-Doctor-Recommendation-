import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { 
  Activity, Users, LogOut, Stethoscope, X, MessageSquare, 
  CheckCircle, AlertCircle, CheckCircle2, XCircle, CalendarDays,
  Clock, Calendar, Trash2, Search, Filter, ChevronLeft, ChevronRight,
  Star, Sliders, LayoutGrid, List, FileText, Image, Loader2
} from 'lucide-react';
import DoctorRatingsView from "./DoctorRatingsView";
import PreReportAnswersCard from "./PreReportAnswersCard";
import HeaderProfileDropdown from './HeaderProfileDropdown';
import DoctorScheduleManager from './DoctorScheduleManager';

const API_BASE_URL = import.meta.env.VITE_API_URL;

// --- Time Formatter Helper ---
const format12HourTime = (timeStr) => {
  if (!timeStr) return "—";
  const [hourString, minute] = timeStr.split(':');
  let hour = parseInt(hourString, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${ampm}`;
};

// --- Consultation Duration Formatter Helper ---
const formatDuration = (duration) => {
  if (!duration) return null;
  const str = String(duration).trim();
  if (!str) return null;
  const match = str.match(/^(\d+)\s*min/i);
  return match ? `${match[1]} min` : str;
};

// --- Scan Date Formatter Helper ---
const formatScanDate = (createdAtStr) => {
  if (!createdAtStr) return "—";
  return createdAtStr.split('T')[0];
};

// --- Calendar Agenda Helpers (Google-Calendar style weekly grid) ---
const HOUR_HEIGHT = 64; // px per hour row in the weekly grid

const timeStringToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
};

const durationStringToMinutes = (duration) => {
  if (!duration) return 30;
  const match = String(duration).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 30;
};

const toDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Monday -> Sunday week containing anchorDate
const getWeekDates = (anchorDate) => {
  const date = new Date(anchorDate);
  const day = date.getDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
};

const formatWeekRangeLabel = (weekDates) => {
  if (!weekDates || weekDates.length === 0) return '';
  const opts = { month: 'short', day: 'numeric' };
  const startLabel = weekDates[0].toLocaleDateString('en-US', opts);
  const endLabel = weekDates[6].toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
};

const calendarBlockStyle = (status) => {
  switch (status) {
    case 'Confirmed': return 'bg-emerald-500 border-emerald-600 text-white';
    case 'Completed': return 'bg-slate-300 border-slate-400 text-slate-600';
    case 'Cancelled': return 'bg-rose-50 border-rose-200 text-rose-400 line-through';
    case 'Pending-Conflict': return 'bg-amber-100 border-amber-400 border-dashed border-2 text-amber-700';
    case 'Reassigned': return 'bg-slate-100 border-slate-300 text-slate-400 line-through';
    default: return 'bg-[#0c2b5e] border-[#0c2b5e] text-white'; // Scheduled
  }
};

const DoctorDashboard = () => {
  const navigate = useNavigate();
  const [scans, setScans]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser]     = useState(null);

  // Review modal
  const [selectedScan, setSelectedScan] = useState(null);
  const [doctorComment, setDoctorComment] = useState('');
  const [activeTab, setActiveTab]   = useState('advice');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Custom Confirmation Dialog State
  const [confirmDialog, setConfirmDialog] = useState({
    show: false,
    title: '',
    message: '',
    action: null
  });

  // Tracks which appointment's Confirm/Cancel/Complete button is mid-request,
  // so we can show a spinner + disable it instead of feeling "hung".
  const [processingApptId, setProcessingApptId] = useState(null);
  // BUG FIX: pehle Confirm/Complete/Cancel teeno buttons sirf processingApptId
  // (appt.id) check karte the - matlab jab bhi in teeno me se koi ek click
  // hota, teeno ek sath "spinning" dikhte the, chahe sirf ek hi request
  // actually chal rahi ho. Ab processingAction bhi track karte hain taake
  // sirf wahi button spin dikhaye jise doctor ne actually click kiya tha.
  const [processingAction, setProcessingAction] = useState(null); // 'Confirmed' | 'Completed' | 'Cancelled'

  // Cancellation Reason State (shown after doctor confirms Yes on cancel)
  const [cancelReasonModal, setCancelReasonModal] = useState({ show: false, apptId: null });
  const [selectedCancelReason, setSelectedCancelReason] = useState('');
  const [customCancelReason, setCustomCancelReason] = useState('');
  const CANCELLATION_REASONS = [
    'Doctor has an emergency',
    'Urgent patient requires immediate attention',
    'Personal reason',
    'Reschedule needed',
    'Other'
  ];

  // Urgent-booking Conflict Resolution State (Pending-Conflict pairs)
  const [conflictReasonModal, setConflictReasonModal] = useState({ show: false, winnerId: null, winnerName: '', loserName: '' });
  const [selectedConflictReason, setSelectedConflictReason] = useState('Urgent patient requires immediate attention');
  const [processingConflictId, setProcessingConflictId] = useState(null);

  // Appointments state
  const [appointments, setAppointments] = useState([]);
  const [loadingAppts, setLoadingAppts] = useState(false);
  const [apptViewMode, setApptViewMode] = useState('table'); // 'table' | 'calendar'

  // Patient Detail History Selection State
  const [selectedPatient, setSelectedPatient] = useState(null);

  // Tables State (Search, Filter, Pagination)
  const [scanSearch, setScanSearch] = useState('');
  const [scanFilter, setScanFilter] = useState('all');
  const [scanPage, setScanPage] = useState(1);
  const itemsPerPage = 5;

  const [apptSearch, setApptSearch] = useState('');
  const [apptFilter, setApptFilter] = useState('all');
  const [apptPage, setApptPage] = useState(1);

  // Calendar Agenda (Google-Calendar style weekly grid) state
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(() => new Date());
  const [selectedCalendarAppt, setSelectedCalendarAppt] = useState(null);

  // Doctor's own weekly availability - used to draw named break/gap blocks in the Calendar Agenda
  const [availability, setAvailability] = useState([]);

  const [patientSearch, setPatientSearch] = useState('');

  // Toast Notification
  const [notification, setNotification] = useState({ show: false, type: '', title: '', message: '' });

  const showNotification = (type, title, message) => {
    setNotification({ show: true, type, title, message });
    setTimeout(() => setNotification({ show: false, type: '', title: '', message: '' }), 3500);
  };

  // BUG FIX: pehle koi bhi modal (Delete/Cancel confirm, Conflict resolve,
  // Review panel, Calendar appointment detail) khulne par background page ka
  // scroll lock nahi hota tha - overlay fixed/centered rehta tha lekin uske
  // peeche appointments table/page apna scroll independently continue karta
  // rehta tha (dono "disconnected" feel dete the). Ab jab bhi in me se koi
  // bhi modal open ho, body scroll lock ho jata hai, aur close hote hi wapas
  // normal ho jata hai.
  useEffect(() => {
    const anyModalOpen = Boolean(
      selectedScan || selectedCalendarAppt || confirmDialog.show || cancelReasonModal.show || conflictReasonModal.show
    );
    document.body.style.overflow = anyModalOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [selectedScan, selectedCalendarAppt, confirmDialog.show, cancelReasonModal.show, conflictReasonModal.show]);

  const handleUnauthorized = useCallback(() => {
    showNotification('error', 'Session Expired', 'Aapka session khatam ho gaya hai. Kripya dobara login karein.');
    localStorage.clear();
    navigate('/login');
  }, [navigate]);

  // ── Fetch helpers ────────────────────────────────────────────────────────
  const fetchScans = useCallback(async (doctorId) => {
    if (!doctorId) return;
    setLoading(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/doctor/scans/${doctorId}?t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleUnauthorized();
      if (res.ok) { const json = await res.json(); setScans(json.data || []); }
    } catch { console.error("Fetch scans error"); }
    finally  { setLoading(false); }
  }, [handleUnauthorized]);

  const fetchAppointments = useCallback(async (doctorId) => {
    if (!doctorId) return;
    setLoadingAppts(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/doctor-appointments/${doctorId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleUnauthorized();
      if (res.ok) { const json = await res.json(); setAppointments(json.data || []); }
    } catch { console.error("Fetch appointments error"); }
    finally  { setLoadingAppts(false); }
  }, [handleUnauthorized]);

  const fetchAvailability = useCallback(async (doctorId) => {
    if (!doctorId) return;
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/doctor-availability/${doctorId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleUnauthorized();
      if (res.ok) { const json = await res.json(); setAvailability(json.data || []); }
    } catch { console.error("Fetch availability error"); }
  }, [handleUnauthorized]);

  // Real-time Updates Setup (Server-Sent Events)
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('user'));
    const token = localStorage.getItem('token');
    
    if (!stored || stored.role !== 'Doctor' || !token) { 
        localStorage.clear();
        navigate('/login'); 
        return; 
    }
    
    setUser(stored);

    fetchScans(stored.id);
    fetchAppointments(stored.id);
    fetchAvailability(stored.id);

    // Connecting Real-Time SSE Stream for efficient push notifications
    const sseUrl = `${API_BASE_URL}/api/doctor-updates-stream/${stored.id}`;
    const eventSource = new EventSource(sseUrl);

    eventSource.onmessage = (event) => {
      try {
        const updateData = JSON.parse(event.data);
        if (updateData.scans) setScans(updateData.scans);
        if (updateData.appointments) setAppointments(updateData.appointments);
        showNotification('success', 'Real-time Sync', 'Dashboard values dynamically updated live.');
      } catch (e) {
        console.error("Error parsing real-time push payload", e);
      }
    };

    eventSource.onerror = () => {
      console.log("SSE link encountered error. Reconnecting gracefully.");
    };

    return () => {
      eventSource.close();
    };
  }, [navigate, fetchScans, fetchAppointments, fetchAvailability]);

  // ── Action Handlers ───────────────────────────────────────────────────────
  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    // Prevent duplicate submissions / race conditions
    if (isSubmitting) return;

    if (!doctorComment.trim()) {
      return showNotification('warning', 'Missing Input', 'Please enter a treatment plan or reason.');
    }

    setIsSubmitting(true);
    const token = localStorage.getItem('token');
    
    try {
      // 1. Keep the exact current payload requirements
      const res = await fetch(`${API_BASE_URL}/doctor/update_scan/${selectedScan.id}`, {
        method: 'PUT',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ 
          comment: doctorComment, 
          invite_to_clinic: activeTab === 'visit', 
          doctor_id: user.id 
        }),
      });

      if (res.status === 401) return handleUnauthorized();
      
      if (res.ok) {
        showNotification('success', 'Review Submitted!', activeTab === 'visit' ? "Clinic invitation sent!" : "Expert advice sent!");
        
        // 2. Extract API response if available
        let responseData = {};
        try {
          const text = await res.text();
          responseData = text ? JSON.parse(text) : {};
        } catch(e) { /* ignore parse error if empty */ }

        let updatedScan = responseData.scan || responseData.data;

        // 3. Fallback targeted single fetch if object wasn't in response
        if (!updatedScan) {
          try {
            const singleRes = await fetch(`${API_BASE_URL}/doctor/scan/${selectedScan.id}`, { 
              headers: { 'Authorization': `Bearer ${token}` } 
            });
            if (singleRes.ok) {
              updatedScan = await singleRes.json();
            }
          } catch (e) { /* Fallback securely handled by optimistic update below */ }
        }

        // 4. Update the local state securely (Targeting only the updated scan)
        setScans(prevScans => prevScans.map(scan => {
          if (scan.id === selectedScan.id) {
            // Guarantee all required properties exist immediately
            const baseUpdate = {
              ...scan,
              status: 'Reviewed',
              doctor_comment: doctorComment,
              invite_to_clinic: activeTab === 'visit',
              doctor_name: user?.name || scan.doctor_name,
              doctor_email: user?.email || scan.doctor_email,
              diagnosis: scan.disease, 
              confidence: scan.confidence,
              review_status: 'Reviewed' 
            };
            // Merge actual API payload if we got it, otherwise use our standard optimistic properties
            return updatedScan ? { ...baseUpdate, ...updatedScan } : baseUpdate;
          }
          return scan;
        }));

        setSelectedScan(null);
        setDoctorComment('');
      } else {
        let errMessage = "Server rejected the request.";
        try {
           const err = await res.json();
           if(err.error) errMessage = err.error;
        } catch(e) {}
        showNotification('error', 'Update Failed', `Error: ${errMessage}`);
      }
    } catch { 
      showNotification('error', 'Server Error', 'Failed to update scan. Please check your connection.'); 
    }
    finally  { 
      setIsSubmitting(false); 
    }
  };

  const handleUpdateAppointmentStatus = async (id, newStatus, reason) => {
    const token = localStorage.getItem('token');
    setProcessingApptId(id);
    setProcessingAction(newStatus);
    try {
      const res = await fetch(`${API_BASE_URL}/api/update-appointment/${id}`, {
        method: 'PUT',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus, ...(reason ? { reason } : {}) }),
      });
      if (res.status === 401) return handleUnauthorized();
      const json = await res.json().catch(() => null);
      if (res.ok) {
        showNotification('success', 'Status Updated', `Appointment marked as ${newStatus}.`);
        fetchAppointments(user.id);
      } else {
        // BUG FIX: pehle yahan hamesha generic "Could not update status." dikhta
        // tha - backend ka specific error (e.g. "This appointment is already
        // Confirmed.") kabhi doctor tak nahi pohanchta tha.
        showNotification('error', 'Failed', json?.error || 'Could not update status.');
        fetchAppointments(user.id);
      }
    } catch { showNotification('error', 'Error', 'Backend connection failed.'); }
    finally { setProcessingApptId(null); setProcessingAction(null); }
  };

  const executeDeleteScan = async (id) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/doctor/delete_scan/${id}`, { 
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleUnauthorized();
      if (res.ok) {
        showNotification('success', 'Deleted', 'Record removed from history.');
        fetchScans(user.id);
      } else { showNotification('error', 'Failed', 'Could not delete record.'); }
    } catch { showNotification('error', 'Error', 'Backend connection failed.'); }
  };

  const executeDeleteAppointment = async (id) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/delete-appointment/${id}`, { 
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleUnauthorized();
      if (res.ok) {
        showNotification('success', 'Deleted', 'Appointment removed from history.');
        fetchAppointments(user.id);
      } else { showNotification('error', 'Failed', 'Could not delete appointment.'); }
    } catch { showNotification('error', 'Error', 'Backend connection failed.'); }
  };

  const handleDeleteScan = (id) => {
    setConfirmDialog({
      show: true,
      title: 'Delete Scan History',
      message: 'Are you sure you want to delete this scan from history permanently?',
      action: () => executeDeleteScan(id)
    });
  };

  const handleDeleteAppointment = (id) => {
    setConfirmDialog({
      show: true,
      title: 'Delete Appointment',
      message: 'Are you sure you want to delete this appointment from your dashboard?',
      action: () => executeDeleteAppointment(id)
    });
  };

  const handleCancelAppointment = (id) => {
    setConfirmDialog({
      show: true,
      title: 'Cancel Appointment',
      message: 'Are you sure you want to cancel this appointment?',
      action: () => setCancelReasonModal({ show: true, apptId: id })
    });
  };

  const confirmCancelWithReason = () => {
    const finalReason = selectedCancelReason === 'Other' ? customCancelReason.trim() : selectedCancelReason;
    handleUpdateAppointmentStatus(cancelReasonModal.apptId, 'Cancelled', finalReason);
    setCancelReasonModal({ show: false, apptId: null });
    setSelectedCancelReason('');
    setCustomCancelReason('');
  };

  // Doctor picks which side of a Pending-Conflict pair to confirm; the other
  // side is automatically marked Reassigned by the backend (single call,
  // single source of truth - see /api/resolve-conflict).
  const openConflictResolve = (winnerId, winnerName, loserName) => {
    setSelectedConflictReason('Urgent patient requires immediate attention');
    setConflictReasonModal({ show: true, winnerId, winnerName, loserName });
  };

  const confirmResolveConflict = async () => {
    const { winnerId, loserName } = conflictReasonModal;
    setConflictReasonModal({ show: false, winnerId: null, winnerName: '', loserName: '' });
    setProcessingConflictId(winnerId);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/resolve-conflict/${winnerId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reason: selectedConflictReason })
      });
      if (res.status === 401) return handleUnauthorized();
      if (res.ok) {
        showNotification('success', 'Conflict Resolved', `Priority patient confirmed. ${loserName} has been notified with alternate slots.`);
        fetchAppointments(user.id);
      } else {
        showNotification('error', 'Failed', 'Could not resolve the conflict.');
      }
    } catch { showNotification('error', 'Error', 'Backend connection failed.'); }
    finally { setProcessingConflictId(null); }
  };

  const handleLogout = () => { localStorage.clear(); navigate('/login'); };

  const getConfidenceData = (raw) => {
    let p = parseFloat(raw) || 0;
    if (p > 0 && p <= 1) p = p * 100;
    else if (p > 100) p = p > 1000 ? p / 100 : p; 
    p = Math.min(Math.max(p, 0), 100);
    let color = "bg-red-500", textColor = "text-red-600"; 
    if (p >= 85) { color = "bg-green-500"; textColor = "text-green-600"; } 
    else if (p >= 50) { color = "bg-orange-500"; textColor = "text-orange-600"; }
    return { value: p.toFixed(1), color, textColor };
  };

  const apptStatusBadge = (status) => {
    const map = {
      Scheduled: 'bg-blue-50 text-blue-700 border-blue-100',
      Confirmed: 'bg-green-50 text-green-700 border-green-100',
      Cancelled: 'bg-red-50 text-red-600 border-red-100',
      Completed: 'bg-slate-100 text-slate-500 border-slate-200',
      'Pending-Conflict': 'bg-amber-50 text-amber-700 border-amber-300',
      Reassigned: 'bg-slate-100 text-slate-400 border-slate-200',
    };
    return map[status] || 'bg-slate-50 text-slate-700 border-slate-100';
  };

  // Severity is the backend's TriageService verdict (CRITICAL/URGENT/ROUTINE) --
  // shown as its own badge so it never gets confused with the booking status badge above.
  const severityBadge = (severity) => {
    const map = {
      CRITICAL: 'bg-red-50 text-red-600 border-red-200',
      URGENT: 'bg-amber-50 text-amber-600 border-amber-200',
      ROUTINE: 'bg-slate-50 text-slate-400 border-slate-200',
    };
    return map[severity] || map.ROUTINE;
  };

  // ── Smart Filter & Sorting Computations ──────────────────────────────────
  const uniquePatients = useMemo(() => {
    const patientMap = {};

    const addRecord = (name, email, ratingVal, reviewVal) => {
      if (!name) return;
      const key = name.toLowerCase().trim();
      if (!patientMap[key]) {
        patientMap[key] = { name, email: email || '—', ratings: [], review: null };
      }
      if (email && patientMap[key].email === '—') patientMap[key].email = email;
      const parsedRating = parseFloat(ratingVal);
      if (!isNaN(parsedRating)) {
        patientMap[key].ratings.push(parsedRating);
        if (reviewVal) patientMap[key].review = reviewVal;
      }
    };

    appointments.forEach(a => addRecord(a.patient_name, a.patient_email, a.patient_rating, a.patient_review));
    scans.forEach(s => addRecord(s.patient_name, s.patient_email, s.patient_rating, s.patient_review));

    return Object.values(patientMap)
      .map(p => ({
        name: p.name,
        email: p.email,
        rating: p.ratings.length ? (p.ratings.reduce((sum, r) => sum + r, 0) / p.ratings.length).toFixed(1) : null,
        review: p.review
      }))
      .filter(p => p.name.toLowerCase().includes(patientSearch.toLowerCase()));
  }, [appointments, scans, patientSearch]);

  const filteredScans = useMemo(() => {
    return scans.filter(s => {
      const matchS = s.patient_name?.toLowerCase().includes(scanSearch.toLowerCase()) || s.disease?.toLowerCase().includes(scanSearch.toLowerCase());
      const matchF = scanFilter === 'all' ? true : s.status === scanFilter;
      return matchS && matchF;
    });
  }, [scans, scanSearch, scanFilter]);

  const paginatedScans = useMemo(() => {
    const startIndex = (scanPage - 1) * itemsPerPage;
    return filteredScans.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredScans, scanPage]);

  const filteredAppointments = useMemo(() => {
    return appointments.filter(a => {
      const matchS = a.patient_name?.toLowerCase().includes(apptSearch.toLowerCase()) || a.disease?.toLowerCase().includes(apptSearch.toLowerCase());
      const matchF = apptFilter === 'all' ? true : a.status?.toLowerCase() === apptFilter.toLowerCase();
      return matchS && matchF;
    });
  }, [appointments, apptSearch, apptFilter]);

  // Pending-Conflict appointments always point at each other via conflict_with_id.
  // Grouped here from the raw (unfiltered) list so a conflict never gets hidden
  // by a search term or status filter - it always needs the doctor's attention.
  const conflictPairs = useMemo(() => {
    const rank = { CRITICAL: 2, URGENT: 1, ROUTINE: 0 };
    const seen = new Set();
    const pairs = [];
    appointments.forEach(a => {
      if (a.status === 'Pending-Conflict' && a.conflict_with_id && !seen.has(a.id)) {
        const other = appointments.find(b => b.id === a.conflict_with_id);
        if (other) {
          seen.add(a.id);
          seen.add(other.id);
          const higherFirst = (rank[a.severity] ?? 0) >= (rank[other.severity] ?? 0) ? [a, other] : [other, a];
          pairs.push(higherFirst);
        }
      }
    });
    return pairs;
  }, [appointments]);

  const paginatedAppointments = useMemo(() => {
    const startIndex = (apptPage - 1) * itemsPerPage;
    return filteredAppointments.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredAppointments, apptPage]);

  // Weekly grid data for the Google-Calendar-style Calendar Agenda view
  const calendarWeekDates = useMemo(() => getWeekDates(calendarAnchorDate), [calendarAnchorDate]);

  const calendarAppointmentsByDay = useMemo(() => {
    const map = {};
    calendarWeekDates.forEach(d => { map[toDateKey(d)] = []; });
    filteredAppointments.forEach(appt => {
      let key = appt.slot_date;
      if (!map[key]) {
        // Agar slot_date strict "YYYY-MM-DD" me nahi hai to bhi try karo
        const parsed = new Date(appt.slot_date);
        if (!isNaN(parsed)) key = toDateKey(parsed);
      }
      if (map[key]) map[key].push(appt);
    });
    return map;
  }, [calendarWeekDates, filteredAppointments]);

  // Har week-date ko uske doctor-availability se milne wale named break/gap
  // blocks se map karta hai, taake weekly grid me Lunch/Breakfast etc dikhein.
  const weekBreaksByDate = useMemo(() => {
    const map = {};
    calendarWeekDates.forEach(d => {
      const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
      const dayEntry = availability.find(a => a.day === dayName);
      const breaks = [];
      if (dayEntry && !dayEntry.off) {
        (dayEntry.slots || []).forEach(slot => {
          if (slot.break_name && slot.break_start && slot.break_end) {
            breaks.push({ name: slot.break_name, start: slot.break_start, end: slot.break_end });
          }
        });
      }
      map[toDateKey(d)] = breaks;
    });
    return map;
  }, [calendarWeekDates, availability]);

  const calendarHourRange = useMemo(() => {
    let minHour = 8, maxHour = 20;
    Object.values(calendarAppointmentsByDay).flat().forEach(appt => {
      const startMin = timeStringToMinutes(appt.slot_time);
      const endMin = startMin + durationStringToMinutes(appt.duration);
      minHour = Math.min(minHour, Math.floor(startMin / 60));
      maxHour = Math.max(maxHour, Math.ceil(endMin / 60));
    });
    Object.values(weekBreaksByDate).flat().forEach(brk => {
      minHour = Math.min(minHour, Math.floor(timeStringToMinutes(brk.start) / 60));
      maxHour = Math.max(maxHour, Math.ceil(timeStringToMinutes(brk.end) / 60));
    });
    return { start: minHour, end: maxHour };
  }, [calendarAppointmentsByDay, weekBreaksByDate]);

  const calendarWeekIsEmpty = useMemo(
    () => Object.values(calendarAppointmentsByDay).every(arr => arr.length === 0),
    [calendarAppointmentsByDay]
  );

  // Specific Single Patient History Filtering
  const selectedPatientScans = useMemo(() => {
    if (!selectedPatient) return [];
    return scans.filter(s => s.patient_name?.toLowerCase().trim() === selectedPatient.name.toLowerCase().trim());
  }, [scans, selectedPatient]);

  const selectedPatientAppointments = useMemo(() => {
    if (!selectedPatient) return [];
    return appointments.filter(a => a.patient_name?.toLowerCase().trim() === selectedPatient.name.toLowerCase().trim());
  }, [appointments, selectedPatient]);

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-[#f8fafc] relative font-sans">
      
      {/* ── Toast Alert System ── */}
      {notification.show && (
        <div className={`fixed top-6 right-6 z-[9999] flex items-start gap-4 p-4 rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] bg-white border-l-4 min-w-[300px] max-w-sm animate-slideInRight
          ${notification.type === 'success' ? 'border-green-500' : ''}
          ${notification.type === 'error'   ? 'border-red-500'   : ''}
          ${notification.type === 'warning' ? 'border-orange-500': ''}
        `}>
          <div className="mt-0.5">
            {notification.type === 'success' && <CheckCircle2 size={22} className="text-green-500" />}
            {notification.type === 'error'   && <XCircle      size={22} className="text-red-500"   />}
            {notification.type === 'warning' && <AlertCircle  size={22} className="text-orange-500"/>}
          </div>
          <div className="flex-1 pr-2">
            <h4 className={`font-black text-sm mb-1
              ${notification.type === 'success' ? 'text-green-700'  : ''}
              ${notification.type === 'error'   ? 'text-red-700'    : ''}
              ${notification.type === 'warning' ? 'text-orange-700' : ''}
            `}>{notification.title}</h4>
            <p className="text-gray-600 text-xs font-medium leading-relaxed">{notification.message}</p>
          </div>
        </div>
      )}

      {/* ── Sidebar Component (Absolute NavLink Integration) ── */}
      <aside className="w-64 bg-[#0c2b5e] text-white p-6 hidden md:flex flex-col shadow-xl z-20">
        <div className="flex items-center gap-3 mb-12 border-b border-white/10 pb-6">
          <div className="p-2 bg-[#3fd5c2] rounded-lg text-[#0c2b5e]">
            <Stethoscope size={24} />
          </div>
          <h1 className="text-xl font-black tracking-tight uppercase">Derma <span className="text-[#3fd5c2]">AI</span></h1>
        </div>

        <nav className="flex-1 space-y-2">
          {[
            { path: '/doctor-dashboard/referrals',     icon: <Activity size={20} />,    label: 'My Referrals' },
            { path: '/doctor-dashboard/appointments',  icon: <Calendar size={20} />,    label: 'Appointments', badge: appointments.filter(a => ['Scheduled', 'Confirmed', 'Pending-Conflict'].includes(a.status)).length || null },
            { path: '/doctor-dashboard/schedule',      icon: <CalendarDays size={20} />, label: 'My Schedule' },
            { path: '/doctor-dashboard/patients',      icon: <Users size={20} />,        label: 'Patients View' },
            { path: '/doctor-dashboard/ratings',       icon: <Star size={20} />,        label: 'Patient Reviews' },
          ].map(({ path, icon, label, badge }) => (
            <NavLink
              key={path}
              to={path}
              onClick={() => setSelectedPatient(null)}
              className={({ isActive }) => `flex items-center justify-between p-4 rounded-2xl font-bold cursor-pointer transition-all ${
                isActive && !selectedPatient
                  ? 'bg-[#3fd5c2]/20 text-[#3fd5c2] border border-[#3fd5c2]/30'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-3">{icon} {label}</span>
              {badge ? (
                <span className="bg-rose-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center">
                  {badge}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <button onClick={handleLogout} className="flex items-center gap-3 p-4 text-red-400 hover:bg-red-500/10 rounded-2xl transition-all font-bold mt-auto">
          <LogOut size={20} /> <span>Sign Out</span>
        </button>
      </aside>

      {/* ── Main Content Screen ── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-8 py-5 flex justify-between items-center z-10 shadow-sm">
          <div>
            <h2 className="text-2xl font-black text-slate-800">Doctor Portal</h2>
            <p className="text-slate-500 text-sm font-medium italic">
              Dr. {user?.name || 'Doctor'} | {user?.specialty || user?.specialization || 'Expert Practitioner'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <HeaderProfileDropdown 
              currentUser={user} 
              onLogout={handleLogout} 
              API_BASE_URL={API_BASE_URL} 
            />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 space-y-8">
          
          {/* ════════════ INDIVIDUAL PATIENT HISTORY WORKFLOW ════════════ */}
          {selectedPatient ? (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setSelectedPatient(null)} 
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center gap-2 transition-all shadow-sm"
                >
                  <ChevronLeft size={16} /> Back to Patients List
                </button>
                <span className="text-xs font-bold text-slate-400">Patient Electronic Health Record</span>
              </div>

              {/* Patient Snapshot card */}
              <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-2xl font-black text-slate-800">{selectedPatient.name}</h3>
                    {selectedPatient.rating ? (
                      <span className="flex items-center gap-1 bg-amber-50 text-amber-600 border border-amber-100 px-2.5 py-0.5 rounded-full text-[10px] font-black">
                        <Star size={12} className="fill-amber-500 text-amber-500" /> {selectedPatient.rating}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 bg-slate-50 text-slate-400 border border-slate-100 px-2.5 py-0.5 rounded-full text-[10px] font-black">
                        Not Rated Yet
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 font-medium text-sm">Contact: {selectedPatient.email}</p>
                  {selectedPatient.review && (
                    <p className="text-slate-400 text-xs italic mt-2">" {selectedPatient.review} "</p>
                  )}
                </div>
                <div className="flex gap-4">
                  <div className="bg-slate-50 px-5 py-3 rounded-2xl border border-slate-100 text-center">
                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Total Scans</p>
                    <span className="text-xl font-black text-[#0c2b5e]">{selectedPatientScans.length}</span>
                  </div>
                  <div className="bg-slate-50 px-5 py-3 rounded-2xl border border-slate-100 text-center">
                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Appointments</p>
                    <span className="text-xl font-black text-[#3fd5c2]">{selectedPatientAppointments.length}</span>
                  </div>
                </div>
              </div>

              {/* History Tabs Content */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Scan Logs for targeted patient */}
                <div className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm">
                  <h4 className="text-base font-black text-slate-800 mb-4 flex items-center gap-2">
                    <Activity size={18} className="text-blue-500" /> Patient Referral Scan Log
                  </h4>
                  {selectedPatientScans.length === 0 ? (
                    <p className="text-sm font-bold text-slate-400 py-10 text-center bg-slate-50/50 rounded-2xl">No scan history recorded.</p>
                  ) : (
                    <div className="space-y-3">
                      {selectedPatientScans.map(s => (
                        <div key={s.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex justify-between items-center">
                          <div>
                            <p className="font-black text-slate-700 text-sm uppercase">{s.disease}</p>
                            <p className="text-xs text-slate-400 font-medium">{formatScanDate(s.created_at)}</p>
                          </div>
                          <span className="text-[10px] font-black px-3 py-1 bg-green-50 text-green-700 rounded-full border border-green-100">
                            {s.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Appointment Logs for targeted patient */}
                <div className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm">
                  <h4 className="text-base font-black text-slate-800 mb-4 flex items-center gap-2">
                    <Calendar size={18} className="text-[#3fd5c2]" /> Consultation Appointments
                  </h4>
                  {selectedPatientAppointments.length === 0 ? (
                    <p className="text-sm font-bold text-slate-400 py-10 text-center bg-slate-50/50 rounded-2xl">No upcoming or past appointment sessions.</p>
                  ) : (
                    <div className="space-y-3">
                      {selectedPatientAppointments.map(a => (
                        <div key={a.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex justify-between items-center">
                          <div>
                            <p className="font-bold text-slate-700 text-sm">{format12HourTime(a.slot_time)}</p>
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs text-slate-400">{a.slot_date}</p>
                              {formatDuration(a.duration) && (
                                <span className="text-[9px] font-black text-[#0c2b5e] bg-white px-1.5 py-0.5 rounded uppercase tracking-wide border border-slate-200">{formatDuration(a.duration)}</span>
                              )}
                            </div>
                          </div>
                          <span className={`text-[9px] px-2.5 py-1 rounded-full font-black uppercase border ${apptStatusBadge(a.status)}`}>
                            {a.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            </div>
          ) : (
            // ════════════ ROUTING SWITCHBOARD ════════════
            <Routes>
              {/* Default Absolute Redirect to Referrals */}
              <Route path="/" element={<Navigate to="/doctor-dashboard/referrals" replace />} />

              {/* 1. REFERRALS SUB-ROUTE */}
              <Route path="referrals" element={
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
                      <p className="text-slate-400 text-xs font-black uppercase tracking-widest">Assigned Scans</p>
                      <h3 className="text-4xl font-black text-slate-800">{scans.length}</h3>
                    </div>
                    <div className="bg-[#3fd5c2] p-6 rounded-[2rem] shadow-lg shadow-[#3fd5c2]/20">
                      <p className="text-[#0c2b5e]/60 text-xs font-black uppercase tracking-widest">To Be Reviewed</p>
                      <h3 className="text-4xl font-black text-[#0c2b5e]">{scans.filter(s => s.status === 'Pending').length}</h3>
                    </div>
                    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
                      <p className="text-slate-400 text-xs font-black uppercase tracking-widest">Completed</p>
                      <h3 className="text-4xl font-black text-slate-800">{scans.filter(s => s.status === 'Reviewed').length}</h3>
                    </div>
                  </div>

                  <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden mt-8">
                    <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4">
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                        <div className="relative">
                          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input 
                            type="text" 
                            placeholder="Search patient or disease..." 
                            value={scanSearch}
                            onChange={(e) => { setScanSearch(e.target.value); setScanPage(1); }}
                            className="pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-orange-400 w-full sm:w-64 transition-all"
                          />
                        </div>
                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1">
                          <Filter size={14} className="text-slate-400" />
                          <select 
                            value={scanFilter} 
                            onChange={(e) => { setScanFilter(e.target.value); setScanPage(1); }}
                            className="bg-transparent text-xs font-bold text-slate-600 focus:outline-none cursor-pointer py-1.5"
                          >
                            <option value="all">All Statuses</option>
                            <option value="Pending">Pending Review</option>
                            <option value="Reviewed">Reviewed</option>
                          </select>
                        </div>
                      </div>
                      {loading && <span className="text-xs text-blue-500 animate-pulse font-bold uppercase tracking-widest">Live Syncing...</span>}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-50/50 text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">
                            <th className="px-8 py-5">Patient Name</th>
                            <th className="px-8 py-5">AI Detection</th>
                            <th className="px-8 py-5">Status / Type</th>
                            <th className="px-8 py-5 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {paginatedScans.length === 0 ? (
                            <tr><td colSpan="4" className="py-20 text-center font-bold text-slate-400">No matching reports located.</td></tr>
                          ) : paginatedScans.map((scan) => (
                            <tr key={scan.id} className="hover:bg-slate-50/80 transition-all group">
                              <td className="px-8 py-6 font-black text-slate-700">
                                {scan.patient_name}
                                <p className="text-slate-400 text-[10px] font-bold uppercase">{formatScanDate(scan.created_at)}</p>
                              </td>
                              <td className="px-8 py-6 font-bold text-slate-700 uppercase text-sm">
                                {scan.disease}
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="h-1.5 w-16 bg-slate-200 rounded-full overflow-hidden">
                                    <div className={`h-full ${getConfidenceData(scan.confidence).color}`} style={{ width: `${getConfidenceData(scan.confidence).value}%` }} />
                                  </div>
                                  <span className="text-[10px] font-bold text-slate-500">{getConfidenceData(scan.confidence).value}%</span>
                                </div>
                              </td>
                              <td className="px-8 py-6">
                                <span className={`text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-wider border ${
                                  scan.status === 'Reviewed' ? (scan.invite_to_clinic ? 'bg-orange-50 text-orange-600 border-orange-100' : 'bg-green-50 text-green-600 border-green-100') : 'bg-blue-50 text-blue-600 border-blue-100'
                                }`}>
                                  {scan.status === 'Reviewed' ? (scan.invite_to_clinic ? 'Clinic Visit' : 'Advice Sent') : 'New Referral'}
                                </span>
                              </td>
                              <td className="px-8 py-6 flex items-center justify-center gap-2">
                                <button onClick={() => { setSelectedScan(scan); setDoctorComment(scan.doctor_comment || ''); setActiveTab(scan.invite_to_clinic ? 'visit' : 'advice'); }} 
                                        className={`px-5 py-2.5 text-[11px] font-black rounded-xl transition-all shadow-sm ${
                                          scan.status === 'Reviewed' ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-[#0c2b5e] text-white hover:bg-[#163a75]'
                                        }`}>
                                  {scan.status === 'Reviewed' ? 'View Summary' : 'Process Report'}
                                </button>
                                {scan.status === 'Reviewed' && (
                                  <button onClick={() => handleDeleteScan(scan.id)} className="p-2.5 bg-red-50 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all opacity-0 group-hover:opacity-100">
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {filteredScans.length > itemsPerPage && (
                      <div className="p-5 border-t border-slate-50 bg-slate-50/30 flex items-center justify-between">
                        <span className="text-xs text-slate-500 font-bold">Showing {paginatedScans.length} of {filteredScans.length} logs</span>
                        <div className="flex gap-2">
                          <button disabled={scanPage === 1} onClick={() => setScanPage(prev => prev - 1)} className="p-2 border rounded-lg bg-white disabled:opacity-50"><ChevronLeft size={16}/></button>
                          <button disabled={scanPage * itemsPerPage >= filteredScans.length} onClick={() => setScanPage(prev => prev + 1)} className="p-2 border rounded-lg bg-white disabled:opacity-50"><ChevronRight size={16}/></button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              } />

              {/* 2. APPOINTMENTS SUB-ROUTE */}
              <Route path="appointments" element={
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-black text-slate-800">Consultation Bookings</h3>
                      <p className="text-slate-400 text-xs font-medium">Manage booked slots and switch calendar agenda views.</p>
                    </div>

                    <div className="flex items-center bg-slate-100 p-1.5 rounded-2xl border self-start">
                      <button onClick={() => setApptViewMode('table')} className={`px-4 py-2 text-xs font-black rounded-xl flex items-center gap-2 transition-all ${apptViewMode === 'table' ? 'bg-white text-[#0c2b5e] shadow-sm' : 'text-slate-500'}`}>
                        <List size={14} /> Classic Table
                      </button>
                      <button onClick={() => setApptViewMode('calendar')} className={`px-4 py-2 text-xs font-black rounded-xl flex items-center gap-2 transition-all ${apptViewMode === 'calendar' ? 'bg-white text-[#0c2b5e] shadow-sm' : 'text-slate-500'}`}>
                        <LayoutGrid size={14} /> Calendar Agenda
                      </button>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
                    <div className="relative w-full sm:w-72">
                      <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="Search slot patient..." 
                        value={apptSearch}
                        onChange={(e) => { setApptSearch(e.target.value); setApptPage(1); }}
                        className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-orange-400 w-full"
                      />
                    </div>
                    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 w-full sm:w-auto justify-between">
                      <span className="text-xs font-bold text-slate-400 flex items-center gap-1"><Sliders size={12}/> Filter:</span>
                      <select 
                        value={apptFilter} 
                        onChange={(e) => { setApptFilter(e.target.value); setApptPage(1); }}
                        className="bg-transparent text-xs font-black text-slate-600 focus:outline-none cursor-pointer"
                      >
                        <option value="all">All Statuses</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="pending-conflict">Pending Conflict</option>
                        <option value="reassigned">Reassigned</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                  </div>

                  {/* ── Booking Conflict Cards: urgent/critical patient double-booked an already-taken slot ── */}
                  {conflictPairs.length > 0 && (
                    <div className="space-y-3">
                      {conflictPairs.map(([a, b]) => (
                        <div key={`conflict-${a.id}-${b.id}`} className="bg-amber-50/70 border-2 border-amber-300 rounded-[1.75rem] p-5 shadow-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <AlertCircle size={16} className="text-amber-600" />
                            <p className="text-xs font-black text-amber-700 uppercase tracking-wider">Booking Conflict — Action Needed</p>
                          </div>
                          <p className="text-[11px] font-bold text-amber-600/80 mb-4 ml-6">
                            {format12HourTime(a.slot_time)} · {a.slot_date} — two patients selected this slot. Confirm one; the other is auto-notified with alternate slots.
                          </p>
                          <div className="grid sm:grid-cols-2 gap-3">
                            {[a, b].map((p, idx) => {
                              const other = idx === 0 ? b : a;
                              return (
                                <div key={p.id} className="bg-white rounded-2xl p-4 border border-amber-100">
                                  <div className="flex items-center justify-between mb-2 gap-2">
                                    <p className="font-black text-slate-800 text-sm truncate">{p.patient_name}</p>
                                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase border shrink-0 ${severityBadge(p.severity)}`}>{p.severity || 'ROUTINE'}</span>
                                  </div>
                                  <p className="text-slate-500 text-[11px] font-bold mb-1 capitalize">{p.disease || 'General Consultation'}</p>
                                  {Array.isArray(p.triage_reasons) && p.triage_reasons.length > 0 && (
                                    <p className="text-slate-400 text-[10px] font-medium mb-3 leading-relaxed">{p.triage_reasons.join(' · ')}</p>
                                  )}
                                  <button
                                    disabled={processingConflictId === a.id || processingConflictId === b.id}
                                    onClick={() => openConflictResolve(p.id, p.patient_name, other.patient_name)}
                                    className="w-full py-2 bg-[#0c2b5e] text-white font-bold text-[11px] rounded-xl hover:bg-black transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                                  >
                                    {processingConflictId === p.id && <Loader2 size={11} className="animate-spin" />} Confirm This Patient
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {apptViewMode === 'table' ? (
                    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="bg-slate-50/50 text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">
                              <th className="px-8 py-5">Patient</th>
                              <th className="px-8 py-5">Date & Time</th>
                              <th className="px-8 py-5">Condition</th>
                              <th className="px-8 py-5">Status</th>
                              <th className="px-8 py-5 text-center">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {paginatedAppointments.length === 0 ? (
                              <tr><td colSpan="5" className="py-20 text-center font-bold text-slate-400">No scheduled sessions matches parameters.</td></tr>
                            ) : paginatedAppointments.map((appt) => (
                              <tr key={appt.id} className="hover:bg-slate-50/80 transition-all group">
                                <td className="px-8 py-6">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-[#0c2b5e]/10 rounded-full flex items-center justify-center text-[#0c2b5e] font-black text-sm">
                                      {(appt.patient_name || 'P').charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                      <p className="font-black text-slate-700 text-sm">{appt.patient_name}</p>
                                      <p className="text-slate-400 text-[10px] font-bold">{appt.patient_email || 'N/A'}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-8 py-6">
                                  <div className="flex items-center gap-2">
                                    <Clock size={13} className="text-slate-400" />
                                    <div>
                                      <p className="font-black text-slate-700 text-sm">{format12HourTime(appt.slot_time)}</p>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        <p className="text-slate-400 text-[10px] font-bold uppercase">{appt.slot_date}</p>
                                        {formatDuration(appt.duration) && (
                                          <span className="text-[9px] font-black text-[#0c2b5e] bg-slate-100 px-1.5 py-0.5 rounded uppercase tracking-wide">{formatDuration(appt.duration)}</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-8 py-6 font-bold text-slate-600 text-sm capitalize">{appt.disease || '—'}</td>
                                <td className="px-8 py-6">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className={`text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-wider border ${apptStatusBadge(appt.status)}`}>
                                      {appt.status || 'Scheduled'}
                                    </span>
                                    {appt.severity && appt.severity !== 'ROUTINE' && (
                                      <span
                                        title={Array.isArray(appt.triage_reasons) ? appt.triage_reasons.join('; ') : ''}
                                        className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase border ${severityBadge(appt.severity)}`}
                                      >
                                        {appt.severity}
                                      </span>
                                    )}
                                  </div>
                                  {(appt.status === 'Reassigned' || appt.status === 'Cancelled') && appt.cancellation_reason && (
                                    <p className="text-slate-400 text-[10px] font-medium mt-1 max-w-[200px] leading-snug">{appt.cancellation_reason}</p>
                                  )}
                                  {appt.auto_resolved && (
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-wide mt-1 flex items-center gap-1">
                                      <Clock size={10} /> Auto-resolved (SLA timeout)
                                    </p>
                                  )}
                                </td>
                                <td className="px-8 py-6 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    {appt.status === 'Pending-Conflict' ? (
                                      <span className="text-[10px] font-bold text-amber-600 italic">See conflict card above ↑</span>
                                    ) : appt.status !== 'Completed' && appt.status !== 'Cancelled' && appt.status !== 'Reassigned' && (
                                      <>
                                        {/* BUG FIX: pehle ye Confirm button 'Confirmed' status pe bhi dikhta
                                            rehta tha - doctor dobara click kar sakta tha, jo ek fazool
                                            duplicate request bhejta tha (koi "already confirmed" warning
                                            nahi thi). Ab appointment already Confirmed ho to ye button hi
                                            hide ho jata hai - sirf Complete/Cancel bachte hain. */}
                                        {appt.status !== 'Confirmed' && (
                                          <button disabled={processingApptId === appt.id} onClick={() => handleUpdateAppointmentStatus(appt.id, 'Confirmed')} className="px-3 py-1.5 bg-green-50 text-green-600 font-bold text-[10px] rounded-lg border border-green-200 hover:bg-green-600 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
                                            {processingApptId === appt.id && processingAction === 'Confirmed' && <Loader2 size={11} className="animate-spin" />}Confirm
                                          </button>
                                        )}
                                        {/* BUG FIX: pehle teeno buttons (Confirm/Complete/Cancel) sirf
                                            processingApptId (appt.id) check karte the - isliye jab bhi
                                            in me se koi ek click hota, teeno ek sath spin/disable ho jate
                                            the, chahe request sirf ek button ki chal rahi ho. Ab spinner
                                            processingAction se bhi match karta hai - sirf wahi button spin
                                            dikhata hai jise doctor ne click kiya (disable sab pe rehta hai
                                            taake ek row pe ek waqt me sirf ek hi action chale). */}
                                        <button disabled={processingApptId === appt.id} onClick={() => handleUpdateAppointmentStatus(appt.id, 'Completed')} className="px-3 py-1.5 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-lg hover:bg-[#0c2b5e] hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
                                          {processingApptId === appt.id && processingAction === 'Completed' && <Loader2 size={11} className="animate-spin" />}Complete
                                        </button>
                                        <button disabled={processingApptId === appt.id} onClick={() => handleCancelAppointment(appt.id)} className="px-3 py-1.5 bg-rose-50 text-rose-600 font-bold text-[10px] rounded-lg border border-rose-200 hover:bg-rose-600 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
                                          {processingApptId === appt.id && processingAction === 'Cancelled' && <Loader2 size={11} className="animate-spin" />}Cancel
                                        </button>
                                      </>
                                    )}
                                    {appt.status !== 'Pending-Conflict' && (
                                      <button onClick={() => handleDeleteAppointment(appt.id)} className="p-2 bg-rose-50 text-rose-500 rounded-lg hover:bg-rose-500 hover:text-white transition-all opacity-0 group-hover:opacity-100"><Trash2 size={14}/></button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {filteredAppointments.length > itemsPerPage && (
                        <div className="p-5 border-t border-slate-50 bg-slate-50/30 flex items-center justify-between">
                          <span className="text-xs text-slate-500 font-bold">Page {apptPage} of {Math.ceil(filteredAppointments.length / itemsPerPage)}</span>
                          <div className="flex gap-2">
                            <button disabled={apptPage === 1} onClick={() => setApptPage(prev => prev - 1)} className="p-2 border rounded-lg bg-white disabled:opacity-50"><ChevronLeft size={14}/></button>
                            <button disabled={apptPage * itemsPerPage >= filteredAppointments.length} onClick={() => setApptPage(prev => prev + 1)} className="p-2 border rounded-lg bg-white disabled:opacity-50"><ChevronRight size={14}/></button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                      {/* Week navigator */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setCalendarAnchorDate(d => { const nd = new Date(d); nd.setDate(nd.getDate() - 7); return nd; })} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 transition-all">
                            <ChevronLeft size={16}/>
                          </button>
                          <button onClick={() => setCalendarAnchorDate(d => { const nd = new Date(d); nd.setDate(nd.getDate() + 7); return nd; })} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 transition-all">
                            <ChevronRight size={16}/>
                          </button>
                          <button onClick={() => setCalendarAnchorDate(new Date())} className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 transition-all text-[10px] font-black text-slate-600 uppercase tracking-wider">
                            Today
                          </button>
                          <span className="font-black text-slate-800 text-sm ml-1">{formatWeekRangeLabel(calendarWeekDates)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-[9px] font-black text-slate-400 uppercase tracking-wider">
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#0c2b5e]"/>Scheduled</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"/>Confirmed</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-400"/>Completed</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-300"/>Cancelled</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-300"/>Break</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-dashed border-amber-600"/>Conflict</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-300"/>Reassigned</span>
                        </div>
                      </div>

                      {/* Weekly time grid */}
                      <div className="overflow-x-auto">
                        <div className="min-w-[880px]">
                          {/* Day headers */}
                          <div className="grid grid-cols-[64px_repeat(7,1fr)] border-b border-slate-100 sticky top-0 bg-white z-[1]">
                            <div></div>
                            {calendarWeekDates.map(d => {
                              const isToday = toDateKey(d) === toDateKey(new Date());
                              return (
                                <div key={d.toISOString()} className={`py-3 text-center border-l border-slate-100 ${isToday ? 'bg-[#3fd5c2]/10' : ''}`}>
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{d.toLocaleDateString('en-US', { weekday: 'short' })}</p>
                                  <p className={`text-sm font-black ${isToday ? 'text-[#0c2b5e]' : 'text-slate-700'}`}>{d.getDate()}</p>
                                </div>
                              );
                            })}
                          </div>

                          {/* Grid body */}
                          <div className="relative">
                            {calendarWeekIsEmpty && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1]">
                                <span className="text-slate-300 font-bold text-sm bg-white/80 px-4 py-2 rounded-xl">No appointments this week</span>
                              </div>
                            )}
                            <div className="grid grid-cols-[64px_repeat(7,1fr)]">
                              {/* Time labels */}
                              <div className="relative">
                                {Array.from({ length: calendarHourRange.end - calendarHourRange.start }, (_, i) => calendarHourRange.start + i).map(hour => (
                                  <div key={hour} style={{ height: HOUR_HEIGHT }} className="relative text-[9px] font-bold text-slate-400 text-right pr-2 border-t border-slate-50 first:border-0">
                                    <span className="absolute -top-2 right-2">{hour % 12 || 12}{hour >= 12 ? 'PM' : 'AM'}</span>
                                  </div>
                                ))}
                              </div>

                              {/* Day columns */}
                              {calendarWeekDates.map(d => {
                                const dateKey = toDateKey(d);
                                const dayAppts = calendarAppointmentsByDay[dateKey] || [];
                                const totalHeight = (calendarHourRange.end - calendarHourRange.start) * HOUR_HEIGHT;
                                return (
                                  <div key={dateKey} className="relative border-l border-slate-100" style={{ height: totalHeight }}>
                                    {Array.from({ length: calendarHourRange.end - calendarHourRange.start }, (_, i) => (
                                      <div key={i} style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }} className="absolute left-0 right-0 border-t border-slate-50"></div>
                                    ))}
                                    {(weekBreaksByDate[dateKey] || []).map((brk, brkIdx) => {
                                      const startMin = timeStringToMinutes(brk.start);
                                      const endMin = timeStringToMinutes(brk.end);
                                      const top = ((startMin - calendarHourRange.start * 60) / 60) * HOUR_HEIGHT;
                                      const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT - 4, 20);
                                      return (
                                        <div
                                          key={`brk-${brkIdx}`}
                                          style={{ top, height }}
                                          className="absolute left-1 right-1 rounded-lg border border-amber-300 bg-amber-50/80 px-2 py-1 text-[9px] font-black text-amber-600 uppercase tracking-wide flex items-center justify-center text-center pointer-events-none z-0"
                                        >
                                          {brk.name}
                                        </div>
                                      );
                                    })}
                                    {dayAppts.map(appt => {
                                      const startMin = timeStringToMinutes(appt.slot_time);
                                      const durMin = durationStringToMinutes(appt.duration);
                                      const top = ((startMin - calendarHourRange.start * 60) / 60) * HOUR_HEIGHT;
                                      const height = Math.max((durMin / 60) * HOUR_HEIGHT - 4, 24);
                                      return (
                                        <button
                                          key={appt.id}
                                          onClick={() => setSelectedCalendarAppt(appt)}
                                          style={{ top, height }}
                                          className={`absolute left-1 right-1 rounded-lg border px-2 py-1 text-left text-[10px] font-bold shadow-sm hover:z-10 hover:shadow-md transition-all overflow-hidden ${calendarBlockStyle(appt.status)}`}
                                        >
                                          <p className="truncate font-black leading-tight">
                                            {(appt.severity === 'CRITICAL' || appt.severity === 'URGENT') && '⚠ '}
                                            {format12HourTime(appt.slot_time)} · {appt.patient_name}
                                          </p>
                                          <p className="truncate opacity-80 leading-tight">{appt.disease || 'General Consultation'}</p>
                                        </button>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              } />


              {/* 3. SCHEDULE SUB-ROUTE */}
              <Route path="schedule" element={
                <div className="animate-in fade-in duration-300">
                  <DoctorScheduleManager 
                    user={user} 
                    showNotification={showNotification} 
                    handleUnauthorized={handleUnauthorized} 
                  />
                </div>
              } />

              {/* 4. PATIENTS VIEW SUB-ROUTE */}
              <Route path="patients" element={
                <div className="bg-white rounded-[2rem] p-8 border border-slate-100 shadow-sm space-y-6 animate-in fade-in duration-300">
                  <div>
                    <h3 className="text-xl font-black text-slate-800">Unified Patient Registry</h3>
                    <p className="text-slate-400 text-xs font-medium">Click on any patient row profile below to filter full operational medical history Logs.</p>
                  </div>

                  <div className="relative max-w-md">
                    <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Search registered patient name..." 
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      className="pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-orange-400 w-full"
                    />
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-slate-50">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50 text-slate-400 text-[10px] font-black uppercase tracking-wider">
                          <th className="p-4 pl-6">Patient Name Identification</th>
                          <th className="p-4">Linked E-mail</th>
                          <th className="p-4 text-center">Satisfaction Score</th>
                          <th className="p-4 text-right pr-6">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {uniquePatients.length === 0 ? (
                          <tr><td colSpan="4" className="p-10 text-center text-slate-400 text-sm font-bold">No registered active patients detected.</td></tr>
                        ) : uniquePatients.map(p => (
                          <tr 
                            key={p.name} 
                            onClick={() => setSelectedPatient(p)}
                            className="hover:bg-orange-50/40 cursor-pointer transition-all group"
                          >
                            <td className="p-4 pl-6 font-black text-slate-700 text-sm group-hover:text-orange-500">{p.name}</td>
                            <td className="p-4 text-slate-500 text-xs font-medium">{p.email}</td>
                            <td className="p-4 text-center">
                              {p.rating ? (
                                <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-600 border border-amber-100 text-[10px] font-black px-2 py-0.5 rounded-full">
                                  <Star size={10} className="fill-amber-500 text-amber-500" /> {p.rating}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 bg-slate-50 text-slate-400 border border-slate-100 text-[10px] font-black px-2 py-0.5 rounded-full">
                                  Not Rated
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-right pr-6 text-xs text-[#0c2b5e] font-black group-hover:underline">Open Health Records &rarr;</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              } />

              {/* 5. REVIEWS/RATINGS SUB-ROUTE */}
              <Route path="ratings" element={
                <DoctorRatingsView doctorId={user?.id} API_BASE_URL={API_BASE_URL} />
              } />
            </Routes>
          )}

        </main>
      </div>

      {/* ── Referral Review Processing Modal ── */}
      {selectedScan && (
        <div className="fixed inset-0 bg-[#0c2b5e]/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn animate-in duration-200">
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col md:flex-row">
            {/* Left Image View Frame */}
            <div className="md:w-1/2 bg-slate-950 flex flex-col relative min-h-[300px] md:min-h-auto">
              {selectedScan.image_url ? (
                <img src={`${API_BASE_URL}${selectedScan.image_url}`} alt="Referral Skin Scan Target" className="w-full h-full object-contain" />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-2"><Image size={40}/><span className="text-xs font-bold">Image Capture Stream Unavailable</span></div>
              )}
              <div className="absolute bottom-6 left-6 right-6 bg-black/60 backdrop-blur-md p-4 rounded-2xl border border-white/10 text-white">
                <span className="text-[10px] bg-[#3fd5c2] text-[#0c2b5e] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">AI Classification Inference</span>
                <h4 className="text-xl font-black mt-1 uppercase text-[#3fd5c2]">{selectedScan.disease}</h4>
                <p className="text-xs text-white/70 mt-0.5">Confidence probability matrix rated at {getConfidenceData(selectedScan.confidence).value}% precision rate.</p>
              </div>
            </div>

            {/* Right Interactive Form Processing Column */}
            <div className="md:w-1/2 p-8 flex flex-col overflow-y-auto">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
                <div>
                  <h3 className="text-xl font-black text-slate-800">Medical Expert Review</h3>
                  <p className="text-xs text-slate-400 font-medium">Patient Reference: <span className="text-slate-700 font-bold">{selectedScan.patient_name}</span></p>
                </div>
                <button onClick={() => setSelectedScan(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-all"><X size={20}/></button>
              </div>
              <PreReportAnswersCard answers={selectedScan.questionnaire_answers} />

              {selectedScan.status !== 'Reviewed' && (
                <div className="flex bg-slate-100 p-1 rounded-xl mb-6 border">
                  <button type="button" onClick={() => setActiveTab('advice')} className={`flex-1 py-2 text-xs font-black rounded-lg transition-all ${activeTab === 'advice' ? 'bg-white text-[#0c2b5e] shadow-sm' : 'text-slate-500'}`}>Provide Direct Advice</button>
                  <button type="button" onClick={() => setActiveTab('visit')} className={`flex-1 py-2 text-xs font-black rounded-lg transition-all ${activeTab === 'visit' ? 'bg-white text-[#0c2b5e] shadow-sm' : 'text-slate-500'}`}>Invite to Physical Clinic</button>
                </div>
              )}

              <form onSubmit={handleReviewSubmit} className="flex-1 flex flex-col min-h-[250px]">
                {activeTab === 'advice' ? (
                  <div className="space-y-2 mb-6">
                    <label className="block text-[10px] font-black text-slate-400 uppercase">Treatment Plan & Diagnostics Guidance</label>
                    <textarea value={doctorComment} onChange={(e) => setDoctorComment(e.target.value)} disabled={selectedScan.status === 'Reviewed' || isSubmitting} placeholder="Write explicit home care parameters or clinical pathways recommendations..." className="w-full h-40 border border-slate-200 rounded-[1.5rem] p-4 text-xs font-medium focus:outline-none focus:border-orange-400 disabled:bg-slate-50" required />
                  </div>
                ) : (
                  <div className="space-y-2 mb-6">
                    <label className="block text-[10px] font-black text-slate-400 uppercase">Clinic Invitation Reason Arguments</label>
                    <textarea value={doctorComment} onChange={(e) => setDoctorComment(e.target.value)} disabled={selectedScan.status === 'Reviewed' || isSubmitting} placeholder="Specify clinical biopsy parameters requiring immediate live diagnostics intervention..." className="w-full h-40 border border-slate-200 rounded-[1.5rem] p-4 text-xs font-medium focus:outline-none focus:border-orange-400 disabled:bg-slate-50" required />
                  </div>
                )}

                {selectedScan.status !== 'Reviewed' ? (
                  <button type="submit" disabled={isSubmitting} className={`w-full py-4 rounded-[1.2rem] font-black text-sm transition-all shadow-md mt-auto active:scale-95 ${activeTab === 'advice' ? 'bg-[#0c2b5e] text-white hover:bg-[#153e81]' : 'bg-[#3fd5c2] text-[#0c2b5e] hover:bg-[#34bda9]'} ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}>
                    {isSubmitting ? "Saving Review..." : "Submit Completed Review"}
                  </button>
                ) : (
                  <div className="mt-auto p-5 bg-green-50 text-green-700 font-bold rounded-2xl flex items-center justify-center gap-2 border border-green-200 text-xs">
                    <CheckCircle size={16}/> Medical Evaluation Pipeline Finalized
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Calendar Agenda: clicked appointment detail popover ── */}
      {selectedCalendarAppt && (
        <div onClick={() => setSelectedCalendarAppt(null)} className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-150">
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl scale-in animate-in duration-200">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="font-black text-slate-800 text-base">{selectedCalendarAppt.patient_name}</h4>
                <p className="text-xs text-slate-400 font-bold mt-0.5">{selectedCalendarAppt.patient_email || 'N/A'}</p>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className={`text-[9px] px-2.5 py-1 rounded-full font-black uppercase border ${apptStatusBadge(selectedCalendarAppt.status)}`}>{selectedCalendarAppt.status}</span>
                {selectedCalendarAppt.severity && selectedCalendarAppt.severity !== 'ROUTINE' && (
                  <span className={`text-[9px] px-2.5 py-1 rounded-full font-black uppercase border ${severityBadge(selectedCalendarAppt.severity)}`}>{selectedCalendarAppt.severity}</span>
                )}
              </div>
            </div>
            <div className="space-y-2 mb-5 text-xs font-bold text-slate-500">
              <p className="flex items-center gap-2">
                <Clock size={13}/> {format12HourTime(selectedCalendarAppt.slot_time)} · {selectedCalendarAppt.slot_date}
                {formatDuration(selectedCalendarAppt.duration) && ` · ${formatDuration(selectedCalendarAppt.duration)}`}
              </p>
              <p className="flex items-center gap-2"><FileText size={13}/> {selectedCalendarAppt.disease || 'General Consultation'}</p>
              {Array.isArray(selectedCalendarAppt.triage_reasons) && selectedCalendarAppt.triage_reasons.length > 0 && (
                <p className="text-slate-400 font-medium text-[11px] leading-relaxed pl-5">{selectedCalendarAppt.triage_reasons.join(' · ')}</p>
              )}
              {(selectedCalendarAppt.status === 'Reassigned' || selectedCalendarAppt.status === 'Cancelled') && selectedCalendarAppt.cancellation_reason && (
                <p className="text-slate-400 font-medium text-[11px] leading-relaxed pl-5">Reason: {selectedCalendarAppt.cancellation_reason}</p>
              )}
              {selectedCalendarAppt.auto_resolved && (
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide pl-5 flex items-center gap-1.5">
                  <Clock size={11} /> Auto-resolved by system (SLA timeout)
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedCalendarAppt.status === 'Pending-Conflict' ? (
                <p className="w-full text-center text-[11px] font-bold text-amber-600 italic py-2">
                  Resolve this via the conflict card in the Appointments list.
                </p>
              ) : selectedCalendarAppt.status !== 'Completed' && selectedCalendarAppt.status !== 'Cancelled' && selectedCalendarAppt.status !== 'Reassigned' && (
                <>
                  {/* BUG FIX: same as table view - don't offer "Confirm" again once already Confirmed */}
                  {selectedCalendarAppt.status !== 'Confirmed' && (
                    <button
                      disabled={processingApptId === selectedCalendarAppt.id}
                      onClick={() => { handleUpdateAppointmentStatus(selectedCalendarAppt.id, 'Confirmed'); setSelectedCalendarAppt(null); }}
                      className="flex-1 px-3 py-2 bg-green-50 text-green-600 font-bold text-[10px] rounded-lg border border-green-200 hover:bg-green-600 hover:text-white transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                    >Confirm</button>
                  )}
                  <button
                    disabled={processingApptId === selectedCalendarAppt.id}
                    onClick={() => { handleUpdateAppointmentStatus(selectedCalendarAppt.id, 'Completed'); setSelectedCalendarAppt(null); }}
                    className="flex-1 px-3 py-2 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-lg hover:bg-[#0c2b5e] hover:text-white transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                  >Complete</button>
                  <button
                    onClick={() => { handleCancelAppointment(selectedCalendarAppt.id); setSelectedCalendarAppt(null); }}
                    className="flex-1 px-3 py-2 bg-rose-50 text-rose-600 font-bold text-[10px] rounded-lg border border-rose-200 hover:bg-rose-600 hover:text-white transition-all flex items-center justify-center gap-1"
                  >Cancel</button>
                </>
              )}
              <button
                onClick={() => { handleDeleteAppointment(selectedCalendarAppt.id); setSelectedCalendarAppt(null); }}
                className="w-full px-3 py-2 bg-white text-rose-500 font-bold text-[10px] rounded-lg border border-rose-100 hover:bg-rose-50 transition-all flex items-center justify-center gap-1.5"
              ><Trash2 size={12}/> Delete Record</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Custom Global Delete Confirmation Dialog overlay ── */}
      {confirmDialog.show && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center shadow-2xl scale-in animate-in duration-200">
            <h3 className="text-base font-black text-slate-800 mb-1">{confirmDialog.title}</h3>
            <p className="text-slate-500 text-xs font-medium mb-5 leading-relaxed">{confirmDialog.message}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDialog({ show: false, title: '', message: '', action: null })} className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-all text-xs">Cancel</button>
              <button onClick={() => { if (confirmDialog.action) confirmDialog.action(); setConfirmDialog({ show: false, title: '', message: '', action: null }); }} className="flex-1 py-2.5 bg-rose-500 text-white font-bold rounded-xl hover:bg-rose-600 transition-all shadow-sm text-xs">Confirm Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancellation Reason Modal (shown after Yes on cancel confirm) ── */}
      {cancelReasonModal.show && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl scale-in animate-in duration-200">
            <h3 className="text-base font-black text-slate-800 mb-1">Cancellation Reason</h3>
            <p className="text-slate-500 text-xs font-medium mb-4 leading-relaxed">Ye reason patient ko notification ke sath bhej diya jayega.</p>
            <div className="space-y-2 mb-4">
              {CANCELLATION_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedCancelReason(r)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl border-2 text-xs font-bold transition-all ${
                    selectedCancelReason === r ? 'bg-[#0c2b5e] border-[#0c2b5e] text-white' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {selectedCancelReason === 'Other' && (
              <textarea
                value={customCancelReason}
                onChange={(e) => setCustomCancelReason(e.target.value)}
                placeholder="Reason likhein..."
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-medium mb-4 min-h-[70px] focus:outline-none focus:border-orange-400"
              />
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setCancelReasonModal({ show: false, apptId: null }); setSelectedCancelReason(''); setCustomCancelReason(''); }}
                className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-all text-xs"
              >
                Back
              </button>
              <button
                disabled={!selectedCancelReason || (selectedCancelReason === 'Other' && !customCancelReason.trim()) || processingApptId === cancelReasonModal.apptId}
                onClick={confirmCancelWithReason}
                className="flex-1 py-2.5 bg-rose-500 text-white font-bold rounded-xl hover:bg-rose-600 transition-all shadow-sm text-xs disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                {processingApptId === cancelReasonModal.apptId && <Loader2 size={12} className="animate-spin" />}
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Conflict Resolve Reason Modal (shown after picking which patient keeps the slot) ── */}
      {conflictReasonModal.show && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl scale-in animate-in duration-200">
            <h3 className="text-base font-black text-slate-800 mb-1">Confirm {conflictReasonModal.winnerName}?</h3>
            <p className="text-slate-500 text-xs font-medium mb-4 leading-relaxed">
              {conflictReasonModal.loserName} will be automatically marked "Reassigned" and notified with this reason plus their next available slots.
            </p>
            <div className="space-y-2 mb-4">
              {CANCELLATION_REASONS.filter(r => r !== 'Other').map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedConflictReason(r)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl border-2 text-xs font-bold transition-all ${
                    selectedConflictReason === r ? 'bg-[#0c2b5e] border-[#0c2b5e] text-white' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConflictReasonModal({ show: false, winnerId: null, winnerName: '', loserName: '' })}
                className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-all text-xs"
              >
                Back
              </button>
              <button
                disabled={!selectedConflictReason}
                onClick={confirmResolveConflict}
                className="flex-1 py-2.5 bg-[#0c2b5e] text-white font-bold rounded-xl hover:bg-black transition-all shadow-sm text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirm & Notify
              </button>
            </div>
          </div>
        </div>
      )}


      <style dangerouslySetInnerHTML={{__html: `
        @keyframes slideInRight { from { opacity:0; transform:translateX(30px); } to { opacity:1; transform:translateX(0); } }
        .animate-slideInRight { animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}} />
    </div>
  );
};

export default DoctorDashboard;