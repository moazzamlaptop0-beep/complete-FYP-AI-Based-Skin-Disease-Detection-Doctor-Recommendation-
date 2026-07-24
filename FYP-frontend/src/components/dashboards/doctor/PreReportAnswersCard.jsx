// src/components/PreReportAnswersCard.jsx
import React from 'react';
import { 
  ClipboardList, Droplets, Flame, TrendingUp, 
  Palette, Maximize, ShieldAlert, MinusCircle 
} from 'lucide-react';

// PreReportQuestionnaireModal.jsx ke clinical triage keys ke sath 100% synchronized!
const QUESTION_META = [
  { key: 'has_severe_pain', label: 'Severe Pain', icon: Flame },
  { key: 'is_bleeding', label: 'Bleeding/Oozing', icon: Droplets },
  { key: 'growing_fast', label: 'Growing Rapidly', icon: TrendingUp },
  { key: 'irregular_border', label: 'Irregular Borders', icon: ShieldAlert },
  { key: 'color_change', label: 'Color Changes', icon: Palette },
  { key: 'diameter_over_6mm', label: 'Diameter > 6mm', icon: Maximize },
];

const PreReportAnswersCard = ({ answers }) => {
  // Check if we have any valid keys inside the answers object
  const hasAnswers = answers && Object.keys(answers).some(
    (key) => answers[key] !== undefined && answers[key] !== null
  );

  return (
    <div className="bg-slate-50/70 border border-slate-200 rounded-[1.5rem] p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList size={14} className="text-[#0c2b5e]" />
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
          Patient Ka Quick Assessment
        </h4>
      </div>

      {hasAnswers ? (
        <div className="grid grid-cols-2 gap-2">
          {QUESTION_META.map(({ key, label, icon: Icon }) => {
            const val = answers[key];
            const isYes = val === true || val === 'true';
            
            return (
              <div key={key} className="bg-white border border-slate-100 rounded-xl px-3 py-2 flex flex-col justify-between">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Icon size={11} className={isYes ? 'text-blue-500' : 'text-slate-400'} /> 
                  {label}
                </p>
                <div className="mt-1 flex items-center">
                  {val === undefined || val === null ? (
                    <span className="text-xs font-black text-slate-300">—</span>
                  ) : isYes ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-red-50 text-red-600 border border-red-100">
                      Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                      No
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-slate-400 text-[11px] font-semibold py-1">
          <MinusCircle size={13} />
          <span>Iss report ke saath koi self-assessment answers dastyab nahi (patient ne skip kiya ho sakta hai).</span>
        </div>
      )}
    </div>
  );
};

export default PreReportAnswersCard;