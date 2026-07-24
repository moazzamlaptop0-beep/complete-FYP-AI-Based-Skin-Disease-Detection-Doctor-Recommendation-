import React, { useEffect, useRef, useState } from 'react';

// Self-contained scroll-reveal hook
const useReveal = (threshold = 0.3) => {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, visible];
};

// Counts up to `target` once `trigger` becomes true; respects prefers-reduced-motion
const useCountUp = (target, trigger, duration = 1400) => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!trigger) return;
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setValue(target);
      return;
    }
    let start = null;
    let raf;
    const step = (timestamp) => {
      if (start === null) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [trigger, target, duration]);
  return value;
};

// Extracted so useCountUp runs at this component's own top level (hooks can't
// be called inside .map() callbacks \u2014 each card needs its own instance).
const StatCard = ({ stat, index, sectionVisible }) => {
  const count = useCountUp(stat.value, sectionVisible, 1200 + index * 150);
  return (
    <div
      style={{ animationDelay: `${index * 120}ms` }}
      className={`ls-reveal ${sectionVisible ? 'ls-in' : ''} relative p-[3px] rounded-3xl overflow-hidden group bg-white shadow-xl hover:-translate-y-2 transition-transform duration-300`}
    >
      {/* Spinning Gradient Line */}
      <div className="absolute inset-[-150%] animate-[spin_4s_linear_infinite] bg-[conic-gradient(from_90deg,transparent_0%,transparent_70%,#3b82f6_100%)] group-hover:bg-[conic-gradient(from_90deg,transparent_0%,transparent_50%,#3b82f6_100%)] opacity-70 group-hover:opacity-100" />

      {/* Inner White Card */}
      <div className="relative h-full bg-white rounded-[21px] p-8 flex flex-col z-10">
        <span className={`ls-data inline-block px-4 py-1.5 rounded-full text-[11px] font-bold text-white uppercase tracking-wider mb-6 self-start ${stat.badgeColor}`}>
          {stat.title}
        </span>

        {/* Big Animated Number */}
        <p className={`ls-display text-5xl font-bold leading-none mb-3 ${stat.factColor ? stat.factColor : "text-[#0c2b5e]"}`}>
          {count}{stat.suffix}
        </p>
        <h3 className={`text-[1.05rem] font-semibold leading-snug mb-8 ${stat.factColor ? stat.factColor : "text-[#0c2b5e]"}`}>
          {stat.headline}
        </h3>

        <div className="flex-1"></div>

        <p className="text-gray-500 text-sm mt-4 border-t border-gray-100 pt-5">
          {stat.details}
        </p>
      </div>
    </div>
  );
};

const LifeSavingDataView = () => {
  const cancerStats = [
    {
      id: 1,
      title: "GLOBAL IMPACT",
      value: 2,
      suffix: "+",
      headline: "people die of skin cancer every hour, worldwide",
      details: "Skin cancer is the most common cancer in the US & globally.",
      badgeColor: "bg-[#4285F4]",
    },
    {
      id: 2,
      title: "RAPID SPREAD",
      value: 2,
      suffix: "nd",
      headline: "most common cancer in people aged 15\u201329",
      details: "Melanoma can spread earlier and more quickly \u2014 age offers no protection.",
      badgeColor: "bg-[#10b981]",
    },
    {
      id: 3,
      title: "LIFETIME RISK",
      value: 2,
      suffix: "%",
      headline: "lifetime risk \u2014 about 1 in 50 people develop skin cancer",
      details: "Early detection is key to survival.",
      badgeColor: "bg-[#a855f7]",
    },
    {
      id: 4,
      title: "THE ULTIMATE FACT",
      value: 99,
      suffix: "%",
      headline: "5-year survival rate with EARLY detection",
      details: "Your life is worth identifying skin cancer early.",
      badgeColor: "bg-[#22c55e]",
      factColor: "text-[#15803d]",
    },
  ];

  const [sectionRef, sectionVisible] = useReveal(0.2);

  return (
    <section ref={sectionRef} className="bg-slate-50 py-20 px-4 font-sans relative overflow-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=IBM+Plex+Mono:wght@600&display=swap');
        .ls-display { font-family: 'Space Grotesk', sans-serif; }
        .ls-data { font-family: 'IBM Plex Mono', monospace; }
        @keyframes ls-rise {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .ls-reveal { opacity: 0; }
        .ls-reveal.ls-in { animation: ls-rise 0.6s cubic-bezier(0.23,1,0.32,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .ls-reveal, .ls-reveal.ls-in { animation: none; opacity: 1; }
        }
      `}</style>

      <div className="max-w-7xl mx-auto">

        {/* Heading Section */}
        <div className="text-center mb-16">
          <h2 className="ls-display text-[#0c2b5e] text-3xl md:text-5xl font-bold mb-4 tracking-tight">
            AI Dermatologist can save your life
          </h2>
          <p className="text-gray-600 text-lg max-w-3xl mx-auto">
            One of the most dangerous diseases that AI Dermatologist can help identify is skin cancer. Skin cancer is the most common cancer in the United States and worldwide.
          </p>
        </div>

        {/* 4 Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {cancerStats.map((stat, index) => (
            <StatCard key={stat.id} stat={stat} index={index} sectionVisible={sectionVisible} />
          ))}
        </div>

      </div>
    </section>
  );
};

export default LifeSavingDataView;