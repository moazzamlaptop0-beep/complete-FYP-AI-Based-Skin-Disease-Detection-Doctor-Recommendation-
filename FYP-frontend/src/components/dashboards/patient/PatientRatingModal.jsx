import React, { useState } from 'react';
import { Star, X, Loader, MessageSquare } from 'lucide-react';

const PatientRatingModal = ({ isOpen, onClose, targetData, onRatingSuccess, API_BASE_URL }) => {
  // Target type ab explicit hona chahiye: targetData.type === 'appointment' | 'scan'.
  // Agar koi caller ye field bhejna bhool jaye, to purane appointment_id-presence
  // heuristic pe fallback karte hain (taake kuch crash na ho) lekin console.warn
  // karte hain taake dev ko turant pata chale ke wo call-site fix karni hai --
  // warna rating galat record (scan vs appointment) se silently link ho sakti hai.
  let isAppointment;
  if (targetData && (targetData.type === 'appointment' || targetData.type === 'scan')) {
    isAppointment = targetData.type === 'appointment';
  } else {
    isAppointment = Boolean(targetData?.appointment_id);
    if (targetData) {
      console.warn(
        'PatientRatingModal: targetData.type missing. Falling back to appointment_id-presence guess. ' +
        'Please pass an explicit type: "appointment" | "scan" from the caller.'
      );
    }
  }

  const isEditing = Boolean(targetData?.patient_rating);
  const [rating, setRating] = useState(targetData?.patient_rating || 0);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewText, setReviewText] = useState(targetData?.patient_review || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  if (!isOpen || !targetData) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rating === 0) {
      setErrorMessage('Kripya kam se kam 1 star zaroor select karein.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');
    const token = localStorage.getItem('token');

    try {
      // Seedha app.py ke naye endpoint se connection
      const response = await fetch(`${API_BASE_URL}/api/rate-doctor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          doctor_id: targetData.doctor_id,
          scan_id: isAppointment ? undefined : targetData.id, // Scans tab se scan ki ID
          appointment_id: isAppointment ? (targetData.appointment_id || targetData.id) : undefined, // Appointments tab se appointment ki ID
          rating: rating,
          review: reviewText
        })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setSuccessMessage(data.message || 'Thank you! Aapki rating successfully submit ho gayi hai.');
        if (onRatingSuccess) onRatingSuccess(rating, reviewText);
        setTimeout(() => {
          onClose();
          setSuccessMessage('');
        }, 1500);
      } else {
        setErrorMessage(data.error || 'Rating save nahi ho saki. Dobara koshish karein.');
      }
    } catch (error) {
      setErrorMessage('Server connection error. Kripya check karein.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] max-w-md w-full p-6 relative shadow-2xl scale-in animate-in duration-200 overflow-hidden">
        
        {/* Close Button */}
        <button 
          onClick={onClose} 
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1 rounded-full transition-colors focus:outline-none"
        >
          <X size={20} />
        </button>

        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-amber-100 shadow-xs">
            <Star className="text-amber-500 fill-amber-500" size={26} />
          </div>
          <h3 className="text-xl font-black text-slate-800 tracking-tight">
            {isEditing ? 'Update Your Rating' : 'Rate Your Consultation'}
          </h3>
          <p className="text-xs text-slate-400 mt-1 font-medium">
            Dr. {targetData.doctor_name || 'Specialist'} ke response aur clinical advice par apna feedback dein.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-4 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 p-3 rounded-xl text-center">
            {errorMessage}
          </div>
        )}
        {successMessage && (
          <div className="mb-4 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 p-3 rounded-xl text-center">
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Star Interactive Control */}
          <div className="flex justify-center items-center gap-2.5 py-2 bg-slate-50 rounded-2xl border border-slate-100">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                type="button"
                key={star}
                className="transition-transform duration-150 hover:scale-120 focus:outline-none"
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
              >
                <Star
                  size={36}
                  className={`transition-colors duration-150 ${
                    star <= (hoverRating || rating)
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-slate-200'
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Written Review Input */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
              <MessageSquare size={12} /> Share Your Experience (Optional)
            </label>
            <textarea
              className="w-full px-4 py-3 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-xs bg-slate-50/50 resize-none min-h-[90px] text-slate-700 font-medium transition-all"
              placeholder="Apne experience ya doctor ke remarks par feedback dein..."
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
            ></textarea>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-200 transition-all focus:outline-none"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-sm disabled:bg-indigo-400 focus:outline-none"
            >
              {isSubmitting ? <Loader className="animate-spin" size={14} /> : (isEditing ? 'Update Review' : 'Submit Review')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PatientRatingModal;