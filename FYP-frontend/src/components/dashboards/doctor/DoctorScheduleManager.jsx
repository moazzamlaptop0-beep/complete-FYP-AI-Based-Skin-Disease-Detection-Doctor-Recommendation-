import React, { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Save, Clock, Banknote, Coffee, Users, Plus, Trash2, Info, X, AlertTriangle } from 'lucide-react';

// Safe check to avoid esbuild compiler warnings targeting ES2015
const getApiUrl = () => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta && import.meta.env) {
      return import.meta.env.VITE_API_URL || '';
    }
  } catch (err) {
    // Fallback if environment variables are not accessible directly
  }
  return '';
};

const API_BASE_URL = getApiUrl() || (typeof window !== 'undefined' ? window.VITE_API_URL : '') || '';

// Initial state setup for standard weekly schedule with multi-slot support
const defaultSchedule = [
  { day: 'Monday',    off: false, slots: [{ start: '09:00', end: '17:00' }] },
  { day: 'Tuesday',   off: false, slots: [{ start: '09:00', end: '17:00' }] },
  { day: 'Wednesday', off: false, slots: [{ start: '09:00', end: '17:00' }] },
  { day: 'Thursday',  off: false, slots: [{ start: '09:00', end: '17:00' }] },
  { day: 'Friday',    off: false, slots: [{ start: '09:00', end: '17:00' }] },
  { day: 'Saturday',  off: false, slots: [{ start: '10:00', end: '14:00' }] },
  { day: 'Sunday',    off: true,  slots: [{ start: '',      end: ''      }] },
];

const DoctorScheduleManager = ({ user, showNotification, handleUnauthorized }) => {
  const [schedule, setSchedule] = useState(defaultSchedule);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false); // i button details modal state
  // ADD (missing safeguard): jab backend batata hai ke ye schedule change
  // kisi existing booked appointment ko orphan kar dega, ye state us warning
  // ko modal mein dikhati hai taake doctor confirm kiye bina overwrite na ho.
  const [scheduleConflict, setScheduleConflict] = useState({ show: false, conflicts: [] });

  // "Add Slot" se pehle doctor se break/gap ka naam poochne wala modal
  const [breakPrompt, setBreakPrompt] = useState({ show: false, dayIndex: null, name: '' });
  const BREAK_NAME_PRESETS = ['Lunch Break', 'Breakfast', 'Tea Break', 'Prayer Break'];

  const [fees, setFees] = useState({ pkr: '', usd: '', duration: '30min', buffer_time: 0 });
  const [isSavingFees, setIsSavingFees] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(278);

  // Fetch Live Exchange Rate for USD conversion
  useEffect(() => {
    const fetchLiveExchangeRate = async () => {
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        if (res.ok) {
          const data = await res.json();
          if (data?.rates?.PKR) setExchangeRate(data.rates.PKR);
        }
      } catch (err) {
        console.error("Exchange rate error", err);
      }
    };
    fetchLiveExchangeRate();
  }, []);

  // Securely parse old legacy layout structure into dynamic slots format so app doesn't break
  const parseScheduleData = (data) => {
    return defaultSchedule.map(def => {
      const found = data.find(d => d.day === def.day);
      if (!found) return def;

      // If data is already in slots format (New backend configuration)
      if (found.slots && Array.isArray(found.slots)) {
        return {
          day: found.day,
          off: found.off,
          slots: found.slots.length > 0 ? found.slots : [{ start: '', end: '' }]
        };
      }

      // Legacy fallback: Convert single-shift layout to the new slots architecture
      const slots = [];
      if (!found.off) {
        const start = found.start || '09:00';
        const end = found.end || '17:00';
        const breakStart = found.break_start_time;
        const breakEnd = found.break_end_time;

        // If legacy break timings exist, split them into two shifts automatically
        if (breakStart && breakEnd && breakStart > start && breakEnd < end) {
          slots.push({ start, end: breakStart });
          slots.push({ start: breakEnd, end });
        } else {
          slots.push({ start, end });
        }
      } else {
        slots.push({ start: '', end: '' });
      }

      return {
        day: found.day,
        off: found.off,
        slots: slots.length > 0 ? slots : [{ start: '', end: '' }]
      };
    });
  };

  const fetchSchedule = useCallback(async () => {
    if (!user?.id) return;
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/doctor-availability/${user.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleUnauthorized();
      if (res.ok) {
        const json = await res.json();
        const data = json.data || [];
        if (data.length) {
          setSchedule(parseScheduleData(data));
        }
      }
    } catch { console.error("Fetch schedule error"); }
  }, [user, handleUnauthorized]);

  const fetchFees = useCallback(async () => {
    if (!user?.id) return;
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/doctor-fees/${user.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleUnauthorized();
      if (res.ok) {
        const json = await res.json();
        const data = json.data;
        if (data) setFees({ 
          pkr: data.pkr || '', 
          usd: data.usd || '', 
          duration: data.duration || '30min',
          buffer_time: data.buffer_time || 0
        });
      }
    } catch { console.error("Fetch fees error"); }
  }, [user, handleUnauthorized]);

  useEffect(() => {
    fetchSchedule();
    fetchFees();
  }, [fetchSchedule, fetchFees]);

  const handlePkrChange = (e) => {
    const pkrValue = e.target.value;
    const usdValue = pkrValue ? (parseFloat(pkrValue) / exchangeRate).toFixed(2) : '';
    setFees({ ...fees, pkr: pkrValue, usd: usdValue });
  };

  // Dynamic Slot input values update
  const handleSlotChange = (dayIndex, slotIndex, field, value) => {
    const s = [...schedule];
    s[dayIndex].slots[slotIndex][field] = value;
    setSchedule(s);
  };

  // Toggle dynamic off day checkbox
  const handleDayOffToggle = (dayIndex) => {
    const s = [...schedule];
    s[dayIndex].off = !s[dayIndex].off;
    if (!s[dayIndex].off && s[dayIndex].slots.length === 0) {
      s[dayIndex].slots = [{ start: '09:00', end: '17:00' }];
    }
    setSchedule(s);
  };

  // "Add Shift Slot" click -> pehle doctor se poochein ye gap kis liye hai
  const handleAddSlot = (dayIndex) => {
    setBreakPrompt({ show: true, dayIndex, name: '' });
  };

  // Doctor ne break ka naam confirm kar diya -> ab naya slot actually add karein
  const confirmAddSlot = () => {
    const { dayIndex, name } = breakPrompt;
    const s = [...schedule];
    s[dayIndex].slots.push({ start: '', end: '', break_name: name.trim() || 'Break' });
    setSchedule(s);
    setBreakPrompt({ show: false, dayIndex: null, name: '' });
  };

  const cancelAddSlot = () => setBreakPrompt({ show: false, dayIndex: null, name: '' });

  // Remove a specific slot index from a day
  const handleRemoveSlot = (dayIndex, slotIndex) => {
    const s = [...schedule];
    if (s[dayIndex].slots.length > 1) {
      s[dayIndex].slots = s[dayIndex].slots.filter((_, idx) => idx !== slotIndex);
      // Pehli slot par koi "preceding break" nahi hoti, isliye stray label clear kar dein
      if (s[dayIndex].slots[0]) delete s[dayIndex].slots[0].break_name;
      setSchedule(s);
    } else {
      showNotification('warning', 'Minimum 1 Slot Required', 'Agar aap availability off karna chahte hain, toh pure day ko uncheck karein.');
    }
  };

  // BUG FIX: pehle na yahan na backend mein koi check tha ke shift ka start
  // time end se pehle ho, ya same din ke do slots overlap na karein. Doctor
  // 17:00 -> 09:00 jaisa ulta slot bhi save ho sakta tha, koi warning nahi
  // aati thi. Time strings "HH:MM" (24hr, <input type="time"> se zero-padded)
  // hain, isliye seedha string compare kaafi hai.
  const validateSchedule = (sched) => {
    for (const dayData of sched) {
      if (dayData.off) continue;

      const activeSlots = [];
      for (const slot of dayData.slots) {
        if (!slot.start || !slot.end) {
          return `${dayData.day}: Please set both start and end time for every shift.`;
        }
        if (slot.start >= slot.end) {
          return `${dayData.day}: Shift start time (${slot.start}) must be before end time (${slot.end}).`;
        }
        activeSlots.push(slot);
      }

      const sorted = [...activeSlots].sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end) {
          return `${dayData.day}: Shifts overlap - ${sorted[i - 1].start}-${sorted[i - 1].end} and ${sorted[i].start}-${sorted[i].end} clash.`;
        }
      }
    }
    return null; // sab theek hai
  };

  const saveSchedule = async (forceOverride = false) => {
    const validationError = validateSchedule(schedule);
    if (validationError) {
      showNotification('error', 'Invalid Schedule', validationError);
      return;
    }

    setIsSavingSchedule(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/update-availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ doctor_id: user.id, schedule, confirm_override: forceOverride }),
      });
      if (res.status === 401) return handleUnauthorized();
      if (res.ok) {
        setScheduleConflict({ show: false, conflicts: [] });
        showNotification('success', 'Schedule Updated', 'All operational slots saved successfully.');
        return;
      }

      const errJson = await res.json().catch(() => null);
      // ADD (missing safeguard): backend ne 409 ke saath conflicting
      // appointments bhej di hain - doctor ko warn karo, silently overwrite
      // mat karo.
      if (res.status === 409 && errJson?.data?.requires_confirmation) {
        setScheduleConflict({ show: true, conflicts: errJson.data.conflicts || [] });
      } else {
        showNotification('error', 'Update Failed', errJson?.error || 'Could not save schedule configurations.');
      }
    } catch { showNotification('error', 'Server Error', 'Backend connection failed.'); }
    finally { setIsSavingSchedule(false); }
  };

  const saveFees = async () => {
    setIsSavingFees(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/update-fees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ doctor_id: user.id, ...fees }),
      });
      if (res.status === 401) return handleUnauthorized();
      res.ok
        ? showNotification('success', 'Fees Updated', 'Consultation settings saved.')
        : showNotification('error', 'Update Failed', 'Could not save fees.');
    } catch { showNotification('error', 'Server Error', 'Backend connection failed.'); }
    finally { setIsSavingFees(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      
      {/* 1. Schedule & Multi-Slots Block */}
      <div className="lg:col-span-2 bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <CalendarDays className="text-[#3fd5c2]" /> Weekly Availability
            </h3>
            <button 
              type="button"
              onClick={() => setShowInfoModal(true)}
              className="text-slate-400 hover:text-[#3fd5c2] transition-colors p-1"
              title="Learn how slots work"
            >
              <Info size={18} />
            </button>
          </div>
          
          <button 
            onClick={() => saveSchedule()} disabled={isSavingSchedule}
            className="bg-[#0c2b5e] hover:bg-[#0c2b5e]/90 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 text-sm transition-all shadow-sm"
          >
            {isSavingSchedule ? "Saving..." : <><Save size={16} /> Save Schedule</>}
          </button>
        </div>

        { }
        <div className="space-y-4">
          {schedule.map((dayData, dayIndex) => (
            <div key={dayData.day} className={`p-5 rounded-2xl border transition-all ${dayData.off ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-200'}`}>
              <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                
                {/* Checkbox for Day Active/Off Status */}
                <div className="flex items-center gap-4 min-w-[140px] pt-2">
                  <input 
                    type="checkbox" 
                    checked={!dayData.off} 
                    onChange={() => handleDayOffToggle(dayIndex)} 
                    className="w-5 h-5 accent-[#3fd5c2] rounded cursor-pointer" 
                  />
                  <span className="font-bold text-slate-700">{dayData.day}</span>
                  {dayData.off && <span className="text-[10px] bg-slate-200 text-slate-500 font-bold px-2 py-0.5 rounded uppercase">Off</span>}
                </div>
                
                {/* Dynamic Shift Slots list */}
                {!dayData.off && (
                  <div className="flex-1 w-full space-y-3">
                    {dayData.slots.map((slot, slotIndex) => (
                      <div key={slotIndex} className="w-full animate-in fade-in slide-in-from-top-1 duration-150">

                        {/* Named Break Chip - is shift se pehle wala gap */}
                        {slotIndex > 0 && slot.break_name && (
                          <div className="flex items-center gap-1.5 mb-1.5 pl-1">
                            <Coffee size={11} className="text-amber-500" />
                            <span className="text-[10px] font-black text-amber-600 uppercase tracking-wide">{slot.break_name}</span>
                          </div>
                        )}

                      <div className="flex items-center gap-3 w-full">
                        
                        {/* Time Slots Wrapper */}
                        <div className="flex-1 flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          <Clock size={14} className="text-[#3fd5c2]" />
                          <input 
                            type="time" 
                            value={slot.start} 
                            onChange={(e) => handleSlotChange(dayIndex, slotIndex, 'start', e.target.value)} 
                            className="bg-transparent text-xs font-bold text-slate-700 outline-none w-full cursor-pointer" 
                          />
                          <span className="text-slate-300 text-xs font-bold">to</span>
                          <input 
                            type="time" 
                            value={slot.end} 
                            onChange={(e) => handleSlotChange(dayIndex, slotIndex, 'end', e.target.value)} 
                            className="bg-transparent text-xs font-bold text-slate-700 outline-none w-full cursor-pointer" 
                          />
                        </div>

                        {/* Trash Button to delete intermediate shifts */}
                        {dayData.slots.length > 1 && (
                          <button 
                            type="button" 
                            onClick={() => handleRemoveSlot(dayIndex, slotIndex)}
                            className="p-2.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700 rounded-xl border border-rose-100 transition-all"
                            title="Delete this shift"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      </div>
                    ))}

                    {/* "+ Add Slot" Trigger and Inline Info Indicator */}
                    <div className="flex items-center gap-3 pt-1">
                      <button 
                        type="button"
                        onClick={() => handleAddSlot(dayIndex)}
                        className="text-xs font-bold text-[#0c2b5e] hover:text-[#3fd5c2] flex items-center gap-1.5 transition-colors bg-slate-100 hover:bg-[#0c2b5e]/5 px-3.5 py-1.5 rounded-lg border border-slate-200"
                      >
                        <Plus size={14} /> Add Shift Slot
                      </button>
                      <span className="text-[10px] text-slate-400 italic">
                        Multiple slots can handle operational gaps automatically.
                      </span>
                    </div>

                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      { }
      {/* 2. Fees & Booking Configurations */}
      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 h-fit">
        <h3 className="text-xl font-black text-slate-800 flex items-center gap-3 mb-6">
          <Banknote className="text-green-500" /> Settings
        </h3>

        <div className="space-y-5">
          <div>
            <label className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2 block">Consultation Fee (PKR)</label>
            <input type="number" value={fees.pkr} onChange={handlePkrChange} placeholder="e.g. 2500" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:border-[#3fd5c2] outline-none" />
          </div>
          <div>
            <label className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2 block">Auto-Converted (USD)</label>
            <input type="text" value={fees.usd} readOnly className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 cursor-not-allowed" />
          </div>

          <hr className="border-slate-100" />

          <div>
            <label className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><Clock size={14}/> Patient Slot Duration</label>
            <select value={fees.duration} onChange={(e) => setFees({...fees, duration: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:border-[#3fd5c2] outline-none">
              <option value="15min">15 Minutes</option>
              <option value="30min">30 Minutes</option>
              <option value="45min">45 Minutes</option>
              <option value="60min">1 Hour</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><Users size={14}/> Gap Between Patients</label>
            <select value={fees.buffer_time} onChange={(e) => setFees({...fees, buffer_time: parseInt(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:border-[#3fd5c2] outline-none">
              <option value={0}>No Gap (0 min)</option>
              <option value={5}>5 Minutes</option>
              <option value={10}>10 Minutes</option>
              <option value={15}>15 Minutes</option>
            </select>
            <p className="text-[10px] text-slate-400 mt-1">This time will be added after every patient.</p>
          </div>

          <button 
            onClick={saveFees} disabled={isSavingFees}
            className="w-full mt-4 bg-green-500 hover:bg-green-600 text-white px-5 py-3 rounded-xl font-black flex items-center justify-center gap-2 text-sm transition-all"
          >
            {isSavingFees ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>

      { }
      {/* ── Schedule Conflict Warning Modal: existing booked appointments jo orphan ho jayengi ── */}
      {scheduleConflict.show && (
        <div className="fixed inset-0 bg-[#0c2b5e]/40 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] w-full max-w-md p-6 shadow-2xl relative border border-slate-100">
            <button
              onClick={() => setScheduleConflict({ show: false, conflicts: [] })}
              className="absolute top-4 right-4 p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 hover:text-slate-800 transition-all"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-red-50 text-red-500 rounded-xl">
                <AlertTriangle size={22} />
              </div>
              <h4 className="text-lg font-black text-slate-800">Booked Appointments Affected</h4>
            </div>

            <p className="text-xs text-slate-500 font-medium mb-4">
              Ye schedule change {scheduleConflict.conflicts.length} already-booked appointment{scheduleConflict.conflicts.length !== 1 ? 's' : ''} ko un-covered chhod degi (unka din off ho gaya ya time ab kisi shift mein nahi aata). Ye patients apni booking ke mutabiq aayenge lekin us waqt aap available nahi honge.
            </p>

            <div className="max-h-48 overflow-y-auto space-y-2 mb-5 -mx-1 px-1">
              {scheduleConflict.conflicts.map((c) => (
                <div key={c.appointment_id} className="flex justify-between items-center text-sm bg-red-50/60 border border-red-100 rounded-xl px-3 py-2.5">
                  <span className="font-bold text-slate-700 truncate">{c.patient_name}</span>
                  <span className="text-slate-500 font-medium text-xs shrink-0 ml-2">{c.date} • {c.time}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setScheduleConflict({ show: false, conflicts: [] })}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-3 rounded-xl font-bold text-xs tracking-wide transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setScheduleConflict({ show: false, conflicts: [] }); saveSchedule(true); }}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-xs tracking-wide transition-all"
              >
                Save Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      { }
      {/* ── Break Name Prompt Modal: shift add karne se pehle doctor se gap ka naam poochta hai ── */}
      {breakPrompt.show && (
        <div className="fixed inset-0 bg-[#0c2b5e]/40 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] w-full max-w-md p-6 shadow-2xl relative border border-slate-100">
            <button
              onClick={cancelAddSlot}
              className="absolute top-4 right-4 p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 hover:text-slate-800 transition-all"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-amber-50 text-amber-500 rounded-xl">
                <Coffee size={22} />
              </div>
              <h4 className="text-lg font-black text-slate-800">Ye Gap Kis Liye Hai?</h4>
            </div>

            <p className="text-xs text-slate-500 font-medium mb-4">
              Naya shift add hone se pehle, is darmiyan wale gap ko naam dein (e.g. Lunch, Breakfast) taake ye calendar mein bhi ussi naam se nazar aaye.
            </p>

            <div className="flex flex-wrap gap-2 mb-4">
              {BREAK_NAME_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setBreakPrompt({ ...breakPrompt, name: preset })}
                  className={`text-xs font-bold px-3.5 py-2 rounded-lg border transition-all ${
                    breakPrompt.name === preset
                      ? 'bg-[#0c2b5e] border-[#0c2b5e] text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-[#3fd5c2]'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            <label className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2 block">Ya Apna Naam Likhein</label>
            <input
              type="text"
              value={breakPrompt.name}
              onChange={(e) => setBreakPrompt({ ...breakPrompt, name: e.target.value })}
              placeholder="e.g. Namaz Break, Rounds..."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:border-[#3fd5c2] outline-none mb-5"
            />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={cancelAddSlot}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-3 rounded-xl font-bold text-xs tracking-wide transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAddSlot}
                className="flex-1 bg-[#0c2b5e] hover:bg-[#0c2b5e]/90 text-white py-3 rounded-xl font-bold text-xs tracking-wide transition-all"
              >
                Add Slot
              </button>
            </div>
          </div>
        </div>
      )}

      { }
      {/* ── Multi-Slot Explanation Information Modal ── */}
      {showInfoModal && (
        <div className="fixed inset-0 bg-[#0c2b5e]/40 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] w-full max-w-lg p-6 shadow-2xl relative border border-slate-100">
            <button 
              onClick={() => setShowInfoModal(false)}
              className="absolute top-4 right-4 p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 hover:text-slate-800 transition-all"
            >
              <X size={18} />
            </button>
            
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-[#3fd5c2]/10 text-[#0c2b5e] rounded-xl">
                <Info size={24} />
              </div>
              <h4 className="text-lg font-black text-slate-800">Operational Shifts (Multi-Slots)</h4>
            </div>

            <div className="space-y-4 text-sm text-slate-600 font-medium">
              <p>
                Aap is portal par ek din mein **ek se zyada custom shifts** (slots) add kar sakte hain. Jab aap multiple slots use karte hain, toh breaks automatically set ho jati hain:
              </p>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2">
                <p className="text-xs font-black text-[#0c2b5e] uppercase tracking-wider">Example Schedule Setup:</p>
                
                <div className="flex justify-between text-xs font-bold border-b pb-1.5 border-slate-200">
                  <span>Shift 1 (Subah)</span>
                  <span className="text-slate-700">09:00 AM - 01:00 PM</span>
                </div>
                
                <div className="flex justify-between text-xs font-black text-rose-500">
                  <span>Auto-Break / Lunch Gap ♨️</span>
                  <span>01:00 PM - 02:00 PM</span>
                </div>

                <div className="flex justify-between text-xs font-bold border-t pt-1.5 border-slate-200">
                  <span>Shift 2 (Shaam)</span>
                  <span className="text-slate-700">02:00 PM - 05:00 PM</span>
                </div>
              </div>

              <div className="p-3.5 bg-green-50 border border-green-100 rounded-xl text-green-700 text-xs">
                <strong>Fayda:</strong> Is naye flow ki wajah se humein break timings alag se lagane ki zaroorat nahi rehti. Do shifts ke darmiyan ka har gap system automatically **"Not Available"** show karega.
              </div>
            </div>

            <button 
              onClick={() => setShowInfoModal(false)}
              className="w-full mt-6 bg-[#0c2b5e] hover:bg-[#0c2b5e]/90 text-white py-3 rounded-xl font-bold text-xs tracking-wide transition-all"
            >
              Samajh Gaya (Close)
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default DoctorScheduleManager;