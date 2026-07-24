import React from 'react';
import { Target, BadgeCheck, Clock, Home, MessageCircle, CheckCircle2 } from 'lucide-react';

const FeaturesMarquee = () => {
  // Copy updated to match the real 10-class model (9 conditions + healthy baseline)
  const features = [
    {
      id: 1,
      icon: Target,
      text: (
        <>
          <span className="font-bold">Screens for 9 skin conditions</span>, including melanoma and skin cancer
        </>
      ),
    },
    {
      id: 2,
      icon: BadgeCheck,
      text: (
        <>
          <span className="font-bold">Over 97% accuracy</span>, based on AI and clinical database
        </>
      ),
    },
    {
      id: 3,
      icon: Clock,
      text: (
        <>
          <span className="font-bold">Result</span> within <span className="font-bold">1 minute</span>
        </>
      ),
    },
    {
      id: 4,
      icon: Home,
      text: (
        <>
          Enables <span className="font-bold">instant at-home screening</span>
        </>
      ),
    },
    {
      id: 5,
      icon: MessageCircle,
      text: (
        <>
          <span className="font-bold">24/7 personal AI Consultant</span>
        </>
      ),
    },
    {
      id: 6,
      icon: CheckCircle2,
      text: (
        <>
          <span className="font-bold">Confirms healthy skin too</span>, not just problems
        </>
      ),
    },
  ];

  return (
    <section className="bg-white py-16 overflow-hidden font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=IBM+Plex+Mono:wght@500&display=swap');
        .fm-display { font-family: 'Space Grotesk', sans-serif; }
      `}</style>

      {/* Header Section */}
      <div className="text-center px-4 mb-10 max-w-3xl mx-auto">
        <h2 className="fm-display text-[#0c2b5e] text-3xl md:text-4xl font-bold mb-3">
          Why should you use AI Dermatologist?
        </h2>
        <p className="text-gray-600 text-lg">
          Developed with dermatologists and powered by artificial intelligence.
        </p>
      </div>

      {/* Marquee Wrapper */}
      <div className="relative flex overflow-hidden group bg-slate-50/50 py-6 border-y border-slate-100">

        {/* Fading edges for a professional look */}
        <div className="absolute left-0 top-0 z-10 w-24 h-full bg-gradient-to-r from-white to-transparent"></div>
        <div className="absolute right-0 top-0 z-10 w-24 h-full bg-gradient-to-l from-white to-transparent"></div>

        {/* Animated Track */}
        <div className="flex w-max animate-custom-marquee group-hover:[animation-play-state:paused]">

          {/* Render the list TWICE for seamless infinite scrolling */}
          {[...Array(2)].map((_, arrayIndex) => (
            <div key={arrayIndex} className="flex gap-6 px-3">
              {features.map((feature) => (
                <div
                  key={`${arrayIndex}-${feature.id}`}
                  className="flex items-center gap-3 bg-white px-6 py-4 rounded-full shadow-sm border border-slate-200 text-[#0c2b5e] whitespace-nowrap transition-all duration-300 hover:scale-105 hover:shadow-md hover:border-[#3fd5c2]/40 cursor-default"
                >
                  <span className="w-7 h-7 shrink-0 rounded-full bg-[#3fd5c2]/10 text-[#259194] flex items-center justify-center">
                    <feature.icon size={14} strokeWidth={2.5} />
                  </span>
                  <span className="text-base text-gray-700">{feature.text}</span>
                </div>
              ))}
            </div>
          ))}

        </div>
      </div>
    </section>
  );
};

export default FeaturesMarquee;