import React, { useState, useRef } from 'react';

const AiScanner = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  
  // Nayi state Alert Popup ke liye
  const [popup, setPopup] = useState({ show: false, type: 'info', message: '' });

  // 🚀 BUG FIX: useRef lagaya hai taake double request block ho sake
  const isAnalyzing = useRef(false);

  const API_BASE_URL = import.meta.env.VITE_API_URL;

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setResult(null); 
      setError(null);
    }
  };

  const closePopup = () => {
    setPopup({ ...popup, show: false });
  };

  const handleAnalyze = async () => {
    // 🚀 BUG FIX: Agar file nahi hai YA already API call ja chuki hai, toh return kar do
    if (!selectedFile || isAnalyzing.current) return; 

    isAnalyzing.current = true; // Lock laga diya
    setLoading(true);
    setResult(null); // Purana result clear kar diya
    setError(null);

    const formData = new FormData();
    formData.append("image", selectedFile);

    // 🚀 NEW: User ID nikal kar form mein daali taake database mein link ho sake
    const storedUserStr = localStorage.getItem('user');
    if (storedUserStr) {
      try {
        const storedUser = JSON.parse(storedUserStr);
        if (storedUser && storedUser.id) {
          formData.append('user_id', storedUser.id);
        }
      } catch (e) {
        console.error("Error parsing user from localStorage", e);
      }
    }

    // 🚀 NEW: LocalStorage se token nikalna
    const token = localStorage.getItem('token');

    try {
      const response = await fetch(`${API_BASE_URL}/predict`, {
        method: "POST",
        headers: {
          // 🚨 YEH LINE SAB SE ZAROORI HAI SECURITY (401 ERROR FIX) KE LIYE
          'Authorization': `Bearer ${token}` 
        },
        body: formData,
      });

      const json = await response.json();

      // 🚀 BUG FIX: Backend (app.py) response shape is { success, data: {...} }.
      // Predictions were nested under "data", so reading disease/confidence/scan_id
      // directly off the top-level object always returned undefined/NaN.
      if (!response.ok || !json.success) {
        throw new Error(json.error || "Server response wasn't OK");
      }

      // Confidence Bug Fix
      let cleanConfidence = parseFloat(json.data.confidence);
      if (cleanConfidence > 100) cleanConfidence = cleanConfidence / 100;
      
      setResult({
        ...json.data,
        confidence: cleanConfidence.toFixed(1)
      });
      
    } catch (err) {
      console.error(err);
      setError("AI connection failed: " + err.message);
      // Error aane par Popup show karein
      setPopup({ 
        show: true, 
        type: 'error', 
        message: err.message || 'Unable to connect to the AI Server. Please check your backend connection.' 
      });
    } finally {
      // 🚀 BUG FIX: Request mukammal hone ke baad lock khol dein
      isAnalyzing.current = false; 
      setLoading(false);
    }
  };

  // UI helpers for dynamic colors
  const getSeverityColor = (conf) => {
    if (conf > 80) return "from-green-400 to-green-600"; 
    if (conf > 50) return "from-orange-400 to-orange-600"; 
    return "from-red-400 to-red-600"; 
  };

  return (
    <section className="py-20 px-6 bg-white font-sans relative">
      <div className="max-w-4xl mx-auto">
        
        <div className="text-center mb-12">
          <span className="text-[#3fd5c2] font-bold tracking-widest uppercase text-sm mb-3 block">
            Live Diagnostics
          </span>
          <h2 className="text-[#0c2b5e] text-4xl font-extrabold tracking-tight">
            Upload Image for <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3fd5c2] to-blue-600">AI Analysis</span>
          </h2>
        </div>

        <div className="bg-[#f8fafc] border border-slate-200 rounded-[2.5rem] p-8 md:p-12 shadow-xl flex flex-col md:flex-row gap-10 items-center">
          
          {/* Left Side: Upload Area */}
          <div className="w-full md:w-1/2 flex flex-col items-center">
            <label 
              htmlFor="image-upload" 
              className={`w-full h-64 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${
                previewUrl ? 'border-[#3fd5c2] bg-teal-50/50' : 'border-slate-300 hover:border-[#3fd5c2] hover:bg-slate-50'
              }`}
            >
              {previewUrl ? (
                <img src={previewUrl} alt="Preview" className="h-full w-full object-cover rounded-3xl p-1" />
              ) : (
                <div className="text-center p-6">
                  <svg className="w-16 h-16 text-slate-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                  </svg>
                  <p className="text-slate-500 font-medium">Click to upload clinical image</p>
                </div>
              )}
              <input id="image-upload" type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>

            <button
              onClick={handleAnalyze}
              disabled={!selectedFile || loading}
              className={`mt-6 w-full py-4 rounded-full font-bold text-lg transition-all duration-300 shadow-lg flex justify-center items-center gap-2 ${
                !selectedFile || loading
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-[#0c2b5e] to-blue-800 text-white hover:shadow-blue-900/30 hover:-translate-y-1'
              }`}
            >
              {loading ? "Analyzing Data..." : "Analyze with AI"}
            </button>
          </div>

          {/* Right Side: Results Display */}
          <div className="w-full md:w-1/2 flex flex-col justify-center">
            {error ? (
              <div className="bg-red-50 text-red-600 p-6 rounded-2xl border border-red-200">
                <p className="font-bold">⚠️ Connection Error</p>
                <p className="text-sm mt-1">{error}</p>
              </div>
            ) : result ? (
              <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide mb-4">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  AI Analysis Complete
                </div>
                
                <h3 className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">Likely Condition</h3>
                <h4 className="text-[#0c2b5e] text-3xl font-black mb-6 leading-tight uppercase">{result.disease}</h4>
                
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <span className="text-slate-600 font-bold text-sm">Confidence Level</span>
                    <span className="text-[#0c2b5e] font-black text-2xl">{result.confidence}%</span>
                  </div>
                  
                  {/* Dynamic Progress Bar */}
                  <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden p-1 shadow-inner">
                    <div 
                      className={`bg-gradient-to-r ${getSeverityColor(result.confidence)} h-full rounded-full transition-all duration-1000 ease-out`}
                      style={{ width: `${result.confidence}%` }}
                    ></div>
                  </div>

                  {/* Examiner-Friendly Warning */}
                  <div className="mt-6 p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
                    <div className="text-amber-500"><AlertCircle size={20} /></div>
                    <p className="text-[10px] text-amber-800 font-medium leading-relaxed italic">
                      Disclaimer: This AI tool is for preliminary screening only. It is NOT a replacement for professional diagnosis.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-slate-100 rounded-[2.5rem]">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                  <Activity className="w-10 h-10 text-slate-200" />
                </div>
                <h4 className="text-[#0c2b5e] font-bold text-lg mb-2 italic opacity-40">Ready to Scan</h4>
                <p className="text-slate-400 text-sm">Awaiting medical image for cloud processing.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- CUSTOM POPUP MODAL --- */}
      {popup.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl transform transition-all animate-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center">
              
              {/* Icon Based on Type */}
              {popup.type === 'error' ? (
                <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
                  <AlertCircle size={32} />
                </div>
              ) : (
                <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mb-4">
                  <Activity className="w-8 h-8" />
                </div>
              )}

              <h3 className={`text-2xl font-black mb-2 ${popup.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
                {popup.type === 'error' ? 'Action Failed' : 'Success'}
              </h3>
              
              <p className="text-slate-500 font-medium leading-relaxed mb-8">
                {popup.message}
              </p>

              <button
                onClick={closePopup}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-6 rounded-xl transition-colors"
              >
                Okay, Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

// Simple Lucide-like icons
const Activity = ({className}) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
);
const AlertCircle = ({size}) => (
  <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
);

export default AiScanner;