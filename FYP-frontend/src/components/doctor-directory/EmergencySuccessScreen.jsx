// src/components/doctor-directory/EmergencySuccessScreen.jsx
import React from 'react';
import { AlertCircle, CheckCircle2, Phone, Home, ArrowLeft, Clock, ClipboardList, Calendar } from 'lucide-react';

const EmergencySuccessScreen = ({ 
  doctorName, 
  doctorPhone, 
  disease, 
  severity, 
  duration, 
  triageReasons,
  onGoBack, 
  onGoHome, 
  onGoToHistory,
  onBookImmediate // Naya prop for booking flow
}) => {
  
  // Backend se aayi hui severity ko use karna, default 'ROUTINE'
  const activeSeverity = severity || 'ROUTINE';
  const reviewDuration = duration || '24-48 hours';

  // BUG FIX (patient safety): pehle doctorPhone missing/fake ho to bhi
  // tel:${doctorPhone} link bina kisi check ke bana diya jata tha — ek
  // CRITICAL patient ek non-existent/placeholder number pe call try kar
  // sakta tha, ye samajh kar ke ye asli clinic ka number hai. Ab clickable
  // "Call Clinic" sirf tab dikhta hai jab ek real phone number mojood ho.
  const hasValidPhone = Boolean(doctorPhone && String(doctorPhone).trim());

  // UI Theme Configuration
  const themeConfig = {
    CRITICAL: {
      color: 'text-red-600',
      bgColor: 'bg-red-50 text-red-500 border border-red-100 shadow-red-200/50',
      title: "CRITICAL PRIORITY!",
      descBg: "bg-red-50 border border-red-200/60 p-5 rounded-2xl text-left w-full mb-8 shadow-sm",
      descHeaderColor: "text-red-700",
      descHeader: "Immediate Action Required",
      descText: `Our AI triage system has flagged your condition as critical. Dr. ${doctorName}'s clinic requires you to book the next available emergency slot immediately.`,
      btn: (
        <>
          <button 
            onClick={onBookImmediate} 
            className="w-full py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98] flex justify-center items-center gap-2 shadow-lg shadow-red-600/20"
          >
            <Calendar size={18} /> Book a Slot Immediately
          </button>
          {hasValidPhone ? (
            <a 
              href={`tel:${doctorPhone}`} 
              className="w-full py-4 bg-[#0f172a] hover:bg-black text-white rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98] flex justify-center items-center gap-2 shadow-md shadow-slate-900/10"
            >
              <Phone size={18} /> Call Clinic
            </a>
          ) : (
            <div 
              className="w-full py-4 bg-slate-100 text-slate-400 rounded-2xl font-bold text-[15px] flex justify-center items-center gap-2 border-2 border-dashed border-slate-200"
              title="This clinic hasn't added a phone number yet"
            >
              <Phone size={18} /> Clinic phone not available — book a slot above
            </div>
          )}
        </>
      )
    },
    URGENT: {
      color: 'text-amber-600',
      bgColor: 'bg-amber-50 text-amber-500 border border-amber-100 shadow-amber-200/50',
      title: "URGENT STATUS",
      descBg: "bg-amber-50 border border-amber-200/60 p-5 rounded-2xl text-left w-full mb-8 shadow-sm",
      descHeaderColor: "text-amber-800",
      descHeader: "High Priority Booking",
      descText: `Your symptoms have been prioritized. Please book an urgent consultation slot so the medical staff can review your condition as soon as possible.`,
      btn: (
        <>
          <button 
            onClick={onBookImmediate} 
            className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98] flex justify-center items-center gap-2 shadow-lg shadow-amber-500/20"
          >
            <Calendar size={18} /> Book a Slot Immediately
          </button>
          <button 
            onClick={onGoToHistory} 
            className="w-full py-4 bg-[#0f172a] hover:bg-black text-white rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98] flex justify-center items-center gap-2 shadow-md shadow-slate-900/10"
          >
            <ClipboardList size={18} /> View Patient History
          </button>
        </>
      )
    },
    ROUTINE: {
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50 text-emerald-500 border border-emerald-100 shadow-emerald-200/50',
      title: "Report Sent Successfully!",
      descBg: "bg-blue-50/60 border border-blue-100 p-5 rounded-2xl text-left w-full mb-8 shadow-sm",
      descHeaderColor: "text-blue-800",
      descHeader: "What is next?",
      descText: `Your report is safely stored in Dr. ${doctorName}'s review hub. Once reviewed, prescriptions or advice will appear directly in your history. Expected timeframe: ${reviewDuration}.`,
      btn: (
        <>
          <button 
            onClick={onGoToHistory} 
            className="w-full py-4 bg-[#0f172a] hover:bg-black text-white rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98] flex justify-center items-center gap-2 shadow-md shadow-slate-900/10"
          >
            <ClipboardList size={18} /> View Patient History
          </button>
          <button 
            onClick={onGoHome} 
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98] flex justify-center items-center gap-2 shadow-md shadow-emerald-500/20"
          >
            <Home size={18} /> Go to Home (Landing Page)
          </button>
        </>
      )
    }
  };

  const currentTheme = themeConfig[activeSeverity] || themeConfig['ROUTINE'];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-100/80 backdrop-blur-md p-4 sm:p-6 transition-all duration-300 overflow-y-auto">
      <div className="bg-white rounded-[2.5rem] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.15)] p-6 sm:p-10 max-w-md w-full text-center animate-popIn border border-slate-200 my-auto">
        
        <div className={`mx-auto w-24 h-24 mb-6 flex items-center justify-center rounded-full shadow-lg ${currentTheme.bgColor}`}>
          {activeSeverity === 'ROUTINE' ? (
            <CheckCircle2 size={46} strokeWidth={2.5} />
          ) : (
            <AlertCircle size={46} strokeWidth={2.5} />
          )}
        </div>
        
        <h2 className={`text-2xl sm:text-3xl font-black mb-3 tracking-tight ${currentTheme.color}`}>
          {currentTheme.title}
        </h2>
        
        <p className="text-slate-500 mb-6 leading-relaxed text-[15px] px-2">
          Your AI evaluation for <span className="font-bold text-slate-800 capitalize">{disease || 'skin scan'}</span> is now shared with <span className="font-bold text-blue-600">Dr. {doctorName}</span>.
        </p>
        
        <div className={currentTheme.descBg}>
          <div className={`flex items-center gap-2.5 font-extrabold text-sm mb-2 ${currentTheme.descHeaderColor}`}>
            {activeSeverity === 'ROUTINE' ? <Clock size={18} /> : <AlertCircle size={18} />}
            {currentTheme.descHeader}
          </div>
          <p className="text-[13px] text-slate-800 font-medium leading-relaxed">
            {currentTheme.descText}
          </p>

          {Array.isArray(triageReasons) && triageReasons.length > 0 && (
            <ul className="mt-3 pt-3 border-t border-slate-200/60 space-y-1">
              {triageReasons.map((reason, i) => (
                <li key={i} className="text-[12px] text-slate-500 font-medium leading-relaxed">
                  &middot; {reason}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-[11px] text-slate-400 font-medium leading-relaxed px-2 -mt-4 mb-8">
          This is an AI-assisted screening result, not a diagnosis. Always follow your doctor's professional assessment.
        </p>
        
        <div className="flex flex-col gap-3">
          {currentTheme.btn}
          
          <button 
            onClick={onGoBack} 
            className="w-full py-4 bg-white hover:bg-slate-50 text-slate-600 border-2 border-slate-200/80 rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98] flex justify-center items-center gap-2"
          >
            <ArrowLeft size={18} /> Back to Directory
          </button>
        </div>
        
      </div>
    </div>
  );
};

export default EmergencySuccessScreen;