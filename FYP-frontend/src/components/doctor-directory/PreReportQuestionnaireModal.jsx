// src/components/doctor-directory/PreReportQuestionnaireModal.jsx
import React, { useState } from 'react';
import { AlertTriangle, X, Send, FastForward, Check } from 'lucide-react';

const PreReportQuestionnaireModal = ({ isOpen, onClose, onSkip, onSubmit, doctorName }) => {
  // State updated to match clinical triage keys on the backend
  const [answers, setAnswers] = useState({
    is_bleeding: false,
    growing_fast: false,
    has_severe_pain: false,
    irregular_border: false,
    color_change: false,
    diameter_over_6mm: false
  });

  if (!isOpen) return null;

  const toggleAnswer = (key) => {
    setAnswers(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmitClick = () => {
    console.log("Pre-Report Questionnaire Answers sent to Backend:", answers);
    onSubmit(answers);
  };

  // Human-friendly clinical questions matched with keys
  const questions = [
    { key: 'is_bleeding', label: 'Is the spot bleeding, oozing, or crusting?' },
    { key: 'growing_fast', label: 'Has the lesion grown rapidly or changed size recently?' },
    { key: 'has_severe_pain', label: 'Are you experiencing severe pain or tenderness?' },
    { key: 'irregular_border', label: 'Does it have jagged, asymmetrical, or irregular borders?' },
    { key: 'color_change', label: 'Has it changed colors or does it have multiple uneven shades?' },
    { key: 'diameter_over_6mm', label: 'Is the diameter larger than 6mm (approx. pencil eraser size)?' }
  ];

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden relative">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-lg font-black text-slate-800">Symptom Checklist</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Questions list */}
        <div className="overflow-y-auto p-5 space-y-5 custom-scrollbar">
          
          {/* Optional Disclaimer Note */}
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3">
            <AlertTriangle className="text-amber-500 shrink-0" size={20} />
            <div>
              <p className="text-sm font-bold text-amber-800">This form is optional</p>
              <p className="text-xs font-medium text-amber-700/80 mt-0.5">
                If you are in a rush or don't have these symptoms, you can skip and directly send the report to Dr. {doctorName}.
              </p>
            </div>
          </div>

          {/* Interactive Modern Selectors */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Select all conditions that apply:</p>
            {questions.map((q) => (
              <label 
                key={q.key} 
                className={`flex items-center gap-3 p-3.5 border rounded-xl cursor-pointer transition-all ${
                  answers[q.key] ? 'bg-blue-50/70 border-blue-500 shadow-sm' : 'bg-white hover:bg-slate-50 border-slate-200'
                }`}
              >
                <input 
                  type="checkbox"
                  checked={answers[q.key]}
                  onChange={() => toggleAnswer(q.key)}
                  className="sr-only"
                />
                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                  answers[q.key] ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 bg-slate-50'
                }`}>
                  {answers[q.key] && <Check size={14} strokeWidth={3} />}
                </div>
                <span className="text-sm font-semibold text-slate-700">{q.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Action Buttons Footer */}
        <div className="p-4 border-t border-slate-100 bg-white flex items-center gap-3">
          <button 
            onClick={onSkip}
            className="flex-1 py-3 px-4 flex items-center justify-center gap-2 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-all text-sm"
          >
            <FastForward size={16} /> Skip & Send
          </button>
          <button 
            onClick={handleSubmitClick}
            className="flex-1 py-3 px-4 flex items-center justify-center gap-2 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-all shadow-md text-sm"
          >
            <Send size={16} /> Submit & Send
          </button>
        </div>

      </div>
    </div>
  );
};

export default PreReportQuestionnaireModal;