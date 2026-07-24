import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Home, ArrowLeft } from 'lucide-react';

const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-32 h-32 bg-blue-100 text-[#0c2b5e] rounded-full flex items-center justify-center mb-8 shadow-inner relative animate-bounce">
        <AlertTriangle size={64} />
      </div>
      
      <h1 className="text-6xl font-black text-[#0c2b5e] mb-4 tracking-tighter">404</h1>
      <h2 className="text-2xl font-bold text-slate-700 mb-2">Page Not Found</h2>
      <p className="text-slate-500 font-medium max-w-md mx-auto mb-10">
        Oops! Jis page ko aap dhoond rahe hain wo exist nahi karta, ya move ho gaya hai.
      </p>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
        <button 
          onClick={() => navigate(-1)} 
          className="flex-1 flex items-center justify-center gap-2 py-4 bg-white text-slate-700 border-2 border-slate-200 rounded-xl font-bold hover:bg-slate-50 transition-all active:scale-95"
        >
          <ArrowLeft size={18} /> Go Back
        </button>
        <button 
          onClick={() => navigate('/')} 
          className="flex-1 flex items-center justify-center gap-2 py-4 bg-[#0c2b5e] text-white rounded-xl font-bold shadow-lg hover:bg-[#153e81] transition-all active:scale-95"
        >
          <Home size={18} /> Home
        </button>
      </div>
    </div>
  );
};

export default NotFound;