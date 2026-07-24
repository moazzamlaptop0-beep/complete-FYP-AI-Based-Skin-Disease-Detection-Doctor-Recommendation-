import React, { useState, useEffect } from 'react';

const WhyUseAiDermatologist = () => {
  // Original Content with Icons
  const features = [
    {
      id: 1,
      title: "Smart",
      description: "AI Dermatologist is created on the basis of artificial intelligence as a result of joint work of IT specialists and doctors. Our app has the same accuracy as a professional dermatologist.",
      icon: (
        <svg className="w-14 h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.792 0-5.484-.28-8.069-.809-1.717-.293-2.3-2.379-1.067-3.61L5 14.5" />
        </svg>
      )
    },
    {
      id: 2,
      title: "Simple",
      description: "Place your phone near a mole or other formation on the skin and within 1 minute you will find out if there is cause for concern.",
      icon: (
        <svg className="w-14 h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    {
      id: 3,
      title: "Accessible",
      description: "AI Dermatologist is available anytime, anywhere. Keep your health in check at your fingertips even when you are on the go.",
      icon: (
        <svg className="w-14 h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 10.5l2.25 2.25L15 8.25" />
        </svg>
      )
    },
    {
      id: 4,
      title: "Affordable",
      description: "AI Dermatologist's leading image analytics features come at an unbeatable price, fit for any request or budget. Flexible pricing plans and customizable bundles will save your practice both time and money.",
      icon: (
        <svg className="w-14 h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    }
  ];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Auto-play Slide Change \u2014 pauses on hover/focus
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % features.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [features.length, isPaused]);

  const handlePrev = () => {
    setCurrentIndex((prevIndex) => (prevIndex === 0 ? features.length - 1 : prevIndex - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % features.length);
  };

  return (
    <div className="w-full bg-white py-16">

      <div
        className="relative mx-auto max-w-[95%] overflow-hidden rounded-3xl p-[3px]"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >

        {/* Snake Border Gradient Animation */}
        <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] animate-snake-spin bg-[conic-gradient(from_0deg,transparent_70%,#38c3c7_100%)] z-0"></div>

        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=IBM+Plex+Mono:wght@500&display=swap');
            .wud-display { font-family: 'Space Grotesk', sans-serif; }

            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
            .animate-snake-spin {
              animation: spin 4s linear infinite;
            }

            @keyframes slideIconIn {
              0% { opacity: 0; transform: translateX(80px) scale(0.8) rotate(-10deg); }
              100% { opacity: 1; transform: translateX(0) scale(1) rotate(0deg); }
            }
            .animate-icon-slide {
              animation: slideIconIn 0.7s cubic-bezier(0.25, 1, 0.5, 1) forwards;
            }

            @keyframes fadeTextIn {
              0% { opacity: 0; transform: translateY(20px); }
              100% { opacity: 1; transform: translateY(0); }
            }
            .animate-text-fade {
              animation: fadeTextIn 0.6s ease-out forwards;
              animation-delay: 0.15s;
              opacity: 0;
            }

            @media (prefers-reduced-motion: reduce) {
              .animate-snake-spin, .animate-icon-slide, .animate-text-fade {
                animation: none !important;
                opacity: 1 !important;
                transform: none !important;
              }
            }
          `}
        </style>

        {/* Main Section Content */}
        <section className="relative h-full w-full py-20 overflow-hidden rounded-[calc(1.5rem-3px)] font-sans z-10 bg-white">

          <div className="relative z-10 w-full max-w-7xl mx-auto px-4 flex flex-col items-center">

            {/* Heading Text */}
            <h2 className="wud-display text-[#0c2b5e] text-3xl md:text-5xl font-bold text-center mb-16 tracking-tight">
              Why is AI Dermatologist worth using?
            </h2>

            {/* Carousel Container */}
            <div className="flex items-center justify-center w-full gap-4 md:gap-8">

              {/* Left Arrow */}
              <button
                onClick={handlePrev}
                aria-label="Previous feature"
                className="p-3 md:p-4 rounded-full bg-gray-100 hover:bg-[#effefb] hover:text-[#259194] text-[#0c2b5e] transition-colors z-20 shrink-0"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              {/* Active Card Container */}
              <div className="w-full max-w-3xl min-h-[300px] overflow-hidden rounded-2xl">

                <div
                  key={currentIndex}
                  className="w-full h-full bg-white p-8 md:p-12 shadow-xl flex flex-col md:flex-row items-center gap-8 border border-gray-100"
                >
                  {/* ICON */}
                  <div className="animate-icon-slide w-28 h-28 shrink-0 rounded-full bg-gradient-to-br from-[#38c3c7] to-[#259194] flex items-center justify-center shadow-[0_10px_30px_rgba(56,195,199,0.4)] z-10">
                    {features[currentIndex].icon}
                  </div>

                  {/* TEXT */}
                  <div className="animate-text-fade text-center md:text-left z-10">
                    <h3 className="wud-display text-[#0c2b5e] text-2xl md:text-3xl font-bold mb-4">
                      {features[currentIndex].title}
                    </h3>
                    <p className="text-gray-600 text-base md:text-lg leading-relaxed">
                      {features[currentIndex].description}
                    </p>
                  </div>

                </div>
              </div>

              {/* Right Arrow */}
              <button
                onClick={handleNext}
                aria-label="Next feature"
                className="p-3 md:p-4 rounded-full bg-gray-100 hover:bg-[#effefb] hover:text-[#259194] text-[#0c2b5e] transition-colors z-20 shrink-0"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

            </div>

            {/* Dots Indicator */}
            <div className="flex gap-2 mt-12 z-20">
              {features.map((feature, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentIndex(index)}
                  aria-label={`Show ${feature.title} feature`}
                  aria-current={currentIndex === index}
                  className={`h-2.5 rounded-full transition-all duration-300 ${
                    currentIndex === index ? "w-8 bg-[#38c3c7]" : "w-2.5 bg-gray-300 hover:bg-gray-400"
                  }`}
                />
              ))}
            </div>

          </div>
        </section>
      </div>
    </div>
  );
};

export default WhyUseAiDermatologist;