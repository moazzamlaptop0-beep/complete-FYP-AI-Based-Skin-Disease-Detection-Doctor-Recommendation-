// src/components/DoctorRatingsView.jsx
import React, { useEffect, useState } from 'react';
import { Star, MessageSquare, Loader, AlertCircle } from 'lucide-react';

const DoctorRatingsView = ({ API_BASE_URL }) => {
  const [ratingsData, setRatingsData] = useState({ average: 0, total: 0, reviews: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDoctorRatings = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/doctor/ratings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setRatingsData(data.data);
      } else {
        setError(data.error || 'Ratings load karne me koi error aaya.');
      }
    } catch (err) {
      setError('Server connection error. Kripya check karein.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDoctorRatings();
  }, [API_BASE_URL]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-white rounded-3xl border border-slate-100">
        <Loader className="animate-spin text-indigo-600 mb-2" size={28} />
        <p className="text-xs text-slate-400 font-medium">Loading Real Patient Reviews...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-rose-50 text-rose-600 rounded-2xl flex items-center gap-2 text-xs font-semibold border border-rose-100">
        <AlertCircle size={16} />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs">
      {/* Performance Summary Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-5 mb-5 gap-4">
        <div>
          <h2 className="text-base font-black text-slate-800">Verified Patient Reviews</h2>
          <p className="text-xs text-slate-400 mt-0.5">Yeh aapka asli feedback data hai jo direct database se load ho raha hai.</p>
        </div>
        
        <div className="flex items-center gap-4 bg-slate-50/80 px-4 py-3 rounded-2xl border border-slate-100">
          <div className="text-center sm:text-right">
            <div className="flex items-center justify-center sm:justify-end gap-1.5">
              <span className="text-2xl font-black text-slate-800">{Number(ratingsData.average).toFixed(1)}</span>
              <Star size={18} className="fill-amber-400 text-amber-400" />
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
              Based on {ratingsData.total} {ratingsData.total === 1 ? 'Review' : 'Reviews'}
            </p>
          </div>
        </div>
      </div>

      {/* Review List Breakdown */}
      {ratingsData.reviews.length === 0 ? (
        <div className="text-center py-10 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
          <MessageSquare className="mx-auto text-slate-300 mb-2" size={28} />
          <p className="text-xs text-slate-500 font-bold">Abhi tak koi real rating nahi mili.</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Jab patient session ya advice ko rate karega toh list yahan live dikhegi.</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
          {ratingsData.reviews.map((rev) => (
            <div key={rev.id} className="p-4 bg-slate-50/40 rounded-2xl border border-slate-100 transition-all hover:bg-white hover:shadow-xs">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="text-xs font-bold text-slate-800">{rev.patient_name || 'Verified Patient'}</h4>
                  <p className="text-[10px] text-slate-400 font-medium">{rev.date}</p>
                </div>
                <div className="flex gap-0.5 bg-amber-50/60 px-2 py-0.5 rounded-lg border border-amber-100 items-center">
                  <Star size={10} className="fill-amber-400 text-amber-400" />
                  <span className="text-[11px] font-black text-amber-700">{rev.rating}</span>
                </div>
              </div>
              {rev.review ? (
                <p className="text-xs text-slate-600 leading-relaxed italic bg-white/60 p-2.5 rounded-xl border border-slate-100/50">
                  "{rev.review}"
                </p>
              ) : (
                <p className="text-[11px] text-slate-400 italic pl-1">Patient ne koi written text comment nahi chora.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DoctorRatingsView;