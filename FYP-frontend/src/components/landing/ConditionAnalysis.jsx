import React, { useState, useEffect, useRef } from 'react';
import { BrainCircuit, Layers } from 'lucide-react';

// Lightweight scroll-reveal hook (no external deps)
const useInView = (threshold = 0.1) => {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView];
};

const ConditionAnalysis = () => {
  const [gridRef, gridInView] = useInView(0.08);

  // Matches the 10-class model exactly: 9 trained conditions + 1 healthy-skin class
  const conditions = [
    { id: "01", name: "Eczema", tag: "Inflammatory", desc: "Chronic itching, dryness & inflamed patches", count: "1,677 imgs", accent: "#f97316", glow: "from-orange-500/15" },
    { id: "02", name: "Melanoma", tag: "Cancer Risk", desc: "The most dangerous form of skin cancer", count: "15.75k+ imgs", accent: "#ef4444", glow: "from-red-500/15" },
    { id: "03", name: "Atopic Dermatitis", tag: "Inflammatory", desc: "Long-term eczema linked to allergy & asthma", count: "1.25k+ imgs", accent: "#ec4899", glow: "from-pink-500/15" },
    { id: "04", name: "Basal Cell Carcinoma", tag: "Cancer Risk", desc: "The most common form of skin cancer (BCC)", count: "3,323 imgs", accent: "#f43f5e", glow: "from-rose-500/15" },
    { id: "05", name: "Melanocytic Nevi", tag: "Benign", desc: "Common moles — typically harmless (NV)", count: "7,970 imgs", accent: "#3b82f6", glow: "from-blue-500/15" },
    { id: "06", name: "Benign Keratosis", tag: "Benign", desc: "Non-cancerous rough or scaly growths (BKL)", count: "2,624 imgs", accent: "#8b5cf6", glow: "from-violet-500/15" },
    { id: "07", name: "Psoriasis & Lichen Planus", tag: "Autoimmune", desc: "Autoimmune-driven scaly patches & rashes", count: null, accent: "#d946ef", glow: "from-fuchsia-500/15" },
    { id: "08", name: "Seborrheic Keratoses", tag: "Benign", desc: "Harmless growths that commonly appear with age", count: null, accent: "#6366f1", glow: "from-indigo-500/15" },
    { id: "09", name: "Tinea & Fungal Infections", tag: "Infection", desc: "Ringworm, candidiasis & related fungal marks", count: null, accent: "#14b8a6", glow: "from-teal-500/15" },
    { id: "10", name: "Normal / Healthy Skin", tag: "Healthy", desc: "No visible signs of concern detected", count: null, accent: "#22c55e", glow: "from-green-500/15" },
  ];

  return (
    <section className="relative bg-[#f8fafc] py-24 px-6 overflow-hidden font-sans">
      {/* Background Decorative Elements */}
      <div className="absolute top-0 left-0 w-64 h-64 bg-cyan-100 rounded-full blur-3xl opacity-40 -translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-100 rounded-full blur-3xl opacity-40 translate-x-1/3 translate-y-1/3"></div>

      <div className="max-w-7xl mx-auto relative z-10">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-6">
          <div className="max-w-2xl">
            <span className="text-[#3fd5c2] font-bold tracking-widest uppercase text-sm mb-3 block">Instant Diagnosis</span>
            <h2 className="text-[#0c2b5e] text-4xl md:text-5xl font-extrabold tracking-tight">
              What can AI detect in <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3fd5c2] to-blue-600">60 Seconds?</span>
            </h2>
          </div>
          <p className="text-gray-500 text-lg md:max-w-xs border-l-4 border-[#3fd5c2] pl-4 italic">
            Trained across 10 dermatologist-informed classes — including a clear "healthy skin" read.
          </p>
        </div>

        {/* Stat pills */}
        <div className="flex flex-wrap gap-3 mb-12">
          <div className="inline-flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-full text-xs font-semibold text-[#0c2b5e] shadow-sm">
            <Layers size={14} className="text-[#3fd5c2]" /> 10 Classes Screened
          </div>
          <div className="inline-flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-full text-xs font-semibold text-[#0c2b5e] shadow-sm">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span> Includes Healthy-Skin Confirmation
          </div>
        </div>

        {/* Grid of all 10 classes */}
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-10">
          {conditions.map((item, index) => (
            <div
              key={item.id}
              style={{ transitionDelay: `${index * 60}ms` }}
              className={`group relative bg-white border border-slate-100 p-5 rounded-3xl transition-all duration-500 hover:shadow-[0_20px_40px_rgba(0,0,0,0.06)] hover:-translate-y-1 overflow-hidden ${
                gridInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
              }`}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${item.glow} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500`}></div>

              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-2xl font-black text-slate-100 group-hover:text-slate-200 transition-colors duration-500">
                    {item.id}
                  </span>
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
                    style={{ color: item.accent, backgroundColor: `${item.accent}14` }}
                  >
                    {item.tag}
                  </span>
                </div>
                <h3 className="text-[#0c2b5e] font-bold text-base mb-1.5 flex items-center gap-2">
                  {item.name}
                  <span
                    className="w-1.5 h-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ backgroundColor: item.accent }}
                  ></span>
                </h3>
                <p className="text-gray-500 text-xs leading-relaxed mb-3">{item.desc}</p>
                {item.count && (
                  <span className="text-[10px] font-mono text-slate-400 border-t border-slate-100 pt-2 block">
                    {item.count} trained
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Neural Network Core - horizontal banner */}
        <div className="bg-[#0c2b5e] rounded-[2rem] p-8 md:p-10 text-white relative overflow-hidden flex flex-col md:flex-row items-center gap-8 shadow-2xl">
          <div className="absolute inset-0 opacity-40 pointer-events-none">
            <div className="absolute -top-20 -left-20 w-64 h-64 border border-white/10 rounded-full animate-[spin_16s_linear_infinite]"></div>
            <div className="absolute -bottom-24 -right-10 w-80 h-80 border border-white/5 rounded-full animate-[spin_22s_linear_infinite_reverse]"></div>
          </div>

          <div className="relative z-10 shrink-0 w-20 h-20 bg-gradient-to-tr from-[#3fd5c2] to-cyan-300 rounded-3xl rotate-12 flex items-center justify-center shadow-[0_0_30px_rgba(63,213,194,0.5)]">
            <BrainCircuit className="w-10 h-10 text-[#0c2b5e]" />
          </div>

          <div className="relative z-10 flex-1 text-center md:text-left">
            <h4 className="text-2xl font-bold mb-2">Neural Network Core</h4>
            <p className="text-blue-100/70 leading-relaxed max-w-xl">
              Trained on tens of thousands of dermatologist-verified images across all 10 classes above — from early cancer markers to a clean bill of healthy skin.
            </p>
          </div>

          <div className="relative z-10 inline-flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full text-sm font-medium border border-white/20 shrink-0">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            AI System Online
          </div>
        </div>

        {/* Floating Tip Banner */}
        <div className="mt-8 bg-white border border-slate-100 p-2 rounded-3xl shadow-lg flex flex-col md:flex-row items-center gap-4 max-w-4xl mx-auto">
            <div className="bg-[#fdf2e9] text-[#e67e22] px-6 py-3 rounded-2xl font-bold text-sm whitespace-nowrap">
              PRO TIP
            </div>
            <p className="text-gray-600 text-sm md:text-base px-4 py-2">
              For <b>best accuracy</b>, ensure your photos are taken in natural daylight without zoom.
            </p>
        </div>

      </div>
    </section>
  );
};

export default ConditionAnalysis;