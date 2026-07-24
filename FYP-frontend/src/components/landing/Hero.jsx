import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserCheck, Cpu, MapPin, FileUp,
  Stethoscope, CalendarCheck, ShieldCheck, ArrowRight
} from 'lucide-react';

// UV Widget Import
import UVWidget from "../widgets/UVWidget";

const Hero = () => {
  const navigate = useNavigate();
  const tiltRef = useRef(null);

  const steps = [
    {
      id: 1,
      title: "Patient Registration",
      desc: "Create a HIPAA-compliant secure profile to manage encrypted medical logs.",
      icon: <UserCheck size={18} />
    },
    {
      id: 2,
      title: "AI Diagnostic Scan",
      desc: "Submit high-resolution skin imagery for immediate automated triage.",
      icon: <Cpu size={18} />
    },
    {
      id: 3,
      title: "Specialist Matching",
      desc: "Filter nearby verified dermatologists by fees, location, and real-time slots.",
      icon: <MapPin size={18} />
    },
    {
      id: 4,
      title: "Secure Transfer",
      desc: "Forward your AI pre-evaluation report instantly to the selected physician.",
      icon: <FileUp size={18} />
    },
    {
      id: 5,
      title: "Clinical Evaluation",
      desc: "Physician reviews the image and issues a digital prescription or clinic booking.",
      icon: <Stethoscope size={18} />
    },
    {
      id: 6,
      title: "Dashboard Sync",
      desc: "Finalize slots online or call. Case data maps instantly to your dashboard.",
      icon: <CalendarCheck size={18} />
    }
  ];

  // Subtle cursor-follow tilt on the widget card — runs on a ref so it never re-renders React.
  const handleTiltMove = (e) => {
    const node = tiltRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    node.style.transform = `perspective(1200px) rotateY(${px * 8}deg) rotateX(${py * -8}deg)`;
  };
  const handleTiltLeave = () => {
    const node = tiltRef.current;
    if (node) node.style.transform = 'perspective(1200px) rotateY(0deg) rotateX(0deg)';
  };

  return (
    <main className="flex-1 flex flex-col lg:flex-row px-6 md:px-16 pt-36 pb-24 gap-12 lg:gap-16 relative w-full items-center justify-center bg-slate-50 min-h-screen font-sans overflow-x-hidden">

      {/* Premium Ambient Background Elements */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-gradient-to-tr from-indigo-200/20 to-blue-200/10 rounded-full blur-3xl pointer-events-none animate-[ambient-slow_20s_infinite_ease-in-out]"></div>
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-gradient-to-tr from-cyan-200/20 to-teal-200/10 rounded-full blur-3xl pointer-events-none animate-[ambient-slow_24s_infinite_ease-in-out_reverse]"></div>
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#f1f5f9_1px,transparent_1px),linear-gradient(to_bottom,#f1f5f9_1px,transparent_1px)] bg-[size:5rem_5rem] opacity-70 pointer-events-none"></div>

      {/* LEFT COLUMN: Modern Typography & Interactive Cards */}
      <div className="w-full lg:w-7/12 flex flex-col justify-center z-10 relative animate-[reveal-up_0.8s_ease-out]">

        {/* Compliance Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200 shadow-sm text-slate-700 w-fit mb-6 animate-[reveal-up_0.6s_ease-out]">
          <ShieldCheck size={14} className="text-indigo-600 animate-pulse" />
          <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-600">Enterprise Telehealth Architecture</span>
        </div>

        {/* High-End Clean Typography */}
        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 text-slate-900 tracking-tight leading-[1.1] animate-[reveal-up_0.7s_ease-out]">
          Clinical Intelligence. <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 bg-[length:200%_auto] animate-[gradient-drift_6s_ease-in-out_infinite]">
            Connected Care Solutions.
          </span>
        </h2>

        <p className="text-slate-600 text-sm md:text-base max-w-xl mb-10 leading-relaxed animate-[reveal-up_0.8s_ease-out]">
          An advanced medical ecosystem bridging automated screening and human expertise. Register securely, analyze conditions instantly, route metrics directly to local practitioners, and centralize your care cycle.
        </p>

        {/* Sleek Adaptive Grid Layout */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10 max-w-2xl">
          {steps.map((step, index) => (
            <div
              key={step.id}
              style={{ animationDelay: `${index * 75}ms` }}
              className="group relative p-5 rounded-xl bg-white border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:shadow-[0_12px_24px_rgba(99,102,241,0.08)] hover:border-indigo-400/50 hover:-translate-y-1 transition-all duration-300 ease-out animate-[reveal-up_0.6s_both] overflow-hidden"
            >
              <div className="absolute top-0 left-0 h-0.5 w-0 bg-gradient-to-r from-indigo-500 to-cyan-400 group-hover:w-full transition-all duration-500 ease-out"></div>
              <div className="w-9 h-9 rounded-lg bg-slate-50 text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600 border border-slate-100 flex items-center justify-center mb-3 transition-colors duration-300">
                {step.icon}
              </div>
              <h4 className="text-slate-900 text-sm font-semibold mb-1.5 flex items-center gap-2">
                <span className="text-[11px] font-mono font-medium text-slate-400">0{step.id}</span>
                {step.title}
              </h4>
              <p className="text-slate-500 text-xs leading-relaxed group-hover:text-slate-600 transition-colors">
                {step.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Refined Premium CTA Button */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 animate-[reveal-up_0.9s_ease-out]">
          <button
            onClick={() => navigate('/try-now')}
            className="group relative inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-slate-900 hover:bg-indigo-600 text-white text-sm font-semibold rounded-xl shadow-md transition-all duration-300 hover:shadow-lg hover:shadow-indigo-600/20 hover:scale-[1.01] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/25 to-transparent skew-x-12"></span>
            <span className="relative z-10">Initiate Secure Consultation</span>
            <ArrowRight size={16} className="relative z-10 group-hover:translate-x-1 transition-transform duration-200" />
          </button>

          <p className="text-[11px] text-slate-400 max-w-xs leading-normal border-l border-slate-200 pl-4 py-0.5">
            Decentralized screening data framework. Official verdicts must be confirmed by a licensed medical practitioner.
          </p>
        </div>

      </div>

      {/* RIGHT COLUMN: UV Index Widget Card Only */}
      <div className="w-full lg:w-5/12 flex flex-col justify-center items-center relative z-10 animate-[reveal-up_1s_ease-out]">

        {/* Cursor-tilt wrapper (outer, JS-driven) + gentle-float (inner, CSS-driven) —
            two different elements so the two transforms never fight each other */}
        <div
          ref={tiltRef}
          onMouseMove={handleTiltMove}
          onMouseLeave={handleTiltLeave}
          className="transition-transform duration-300 ease-out will-change-transform"
        >
          <div className="animate-[gentle-float_6s_infinite_ease-in-out]">
            <div className="relative rounded-3xl shadow-[0_20px_50px_rgba(12,43,94,0.08)] border border-slate-100 bg-white">
              <UVWidget />
            </div>
          </div>
        </div>

      </div>

      {/* Embedded High-End CSS Micro-Animations */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes reveal-up {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes gentle-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes ambient-slow {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          50% { transform: translate(30px, -20px) scale(1.05); }
        }
        @keyframes gradient-drift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}} />

    </main>
  );
};

export default Hero;