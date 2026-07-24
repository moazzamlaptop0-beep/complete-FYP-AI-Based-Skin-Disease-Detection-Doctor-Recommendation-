import React, { useState } from 'react';

const HowDoesAiAnalyze = () => {
  const [isActive, setIsActive] = useState(false);

  return (
    // Background White/Off-White aur Text Color set kiya gaya hai
    <section className="relative w-full py-24 bg-[#fafafa] font-sans overflow-hidden flex justify-center text-gray-800">
      
      <style>
        {`
          .perspective-container {
            perspective: 1200px;
          }
          .preserve-3d {
            transform-style: preserve-3d;
          }
          /* Card Tilt Effect when active */
          .active-card {
            transform: rotateX(15deg) rotateY(-20deg);
            box-shadow: -20px 20px 40px rgba(0, 0, 0, 0.1), 
                         20px -20px 40px rgba(0, 0, 0, 0.1);
          }
          /* Pop Out Effect for the AI Text */
          .pop-out-element {
            transform: translateZ(100px) translateY(-30px) scale(1.1);
            text-shadow: 0 20px 30px rgba(0,0,0,0.4);
          }
        `}
      </style>

      <div className="max-w-7xl w-full px-6 flex flex-col lg:flex-row items-center justify-center gap-12 lg:gap-20">
        
        {/* LEFT SIDE: The 3D Interactive AI Card (Isko dark hi rakha hai taake premium lage) */}
        <div 
          className="perspective-container cursor-pointer z-20 shrink-0"
          onClick={() => setIsActive(!isActive)}
        >
          <div 
            className={`preserve-3d relative w-[300px] h-[400px] rounded-3xl transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${
              isActive ? 'active-card' : 'bg-white shadow-2xl hover:-translate-y-2'
            }`}
          >
            {/* Card Background Layer */}
            <div className="absolute inset-0 rounded-3xl overflow-hidden bg-gradient-to-br from-[#0c2b5e] to-[#040a18] border border-cyan-500/20 shadow-2xl">
              <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_center,rgba(56,195,199,0.4)_0%,transparent_70%)]"></div>
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:20px_20px]"></div>
            </div>

            {/* Click me hint */}
            <div className={`absolute top-6 w-full text-center transition-opacity duration-300 ${isActive ? 'opacity-0' : 'opacity-100 animate-pulse'}`}>
               <span className="bg-white/10 text-cyan-300 text-xs tracking-widest px-4 py-1.5 rounded-full backdrop-blur-md border border-cyan-500/30">
                 CLICK TO ANALYZE
               </span>
            </div>

            {/* The "AI" Graphic Layer */}
            <div 
              className={`preserve-3d absolute inset-0 flex items-center justify-center transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                isActive ? 'pop-out-element' : ''
              }`}
            >
              <h1 className="text-[10rem] font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-cyan-300 via-blue-400 to-pink-400 drop-shadow-[0_0_15px_rgba(56,195,199,0.5)]">
                AI
              </h1>
            </div>
            
          </div>
        </div>

        {/* RIGHT SIDE: The Hidden Content that Animates In */}
        <div 
          className={`w-full max-w-2xl transition-all duration-1000 ease-[cubic-bezier(0.23,1,0.32,1)] z-10 ${
            isActive 
              ? 'opacity-100 translate-x-0 blur-none' 
              : 'opacity-0 translate-x-20 blur-sm pointer-events-none absolute lg:relative'
          }`}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-[#0c2b5e] mb-6 leading-tight drop-shadow-sm">
            How does <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-blue-600">Artificial Intelligence</span> analyze images?
          </h2>
          
          <div className="space-y-5 text-gray-600 text-base md:text-lg leading-relaxed relative">
            {/* Glowing line on the left */}
            <div className="absolute -left-6 top-0 bottom-0 w-1 bg-gradient-to-b from-cyan-400 via-pink-400 to-transparent rounded-full opacity-60"></div>

            <p className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
              AI Dermatologist uses a deep machine learning algorithm (AI-algorithm). The human ability to learn from examples and experiences has been transferred to a computer. For this purpose, the neural network has been trained using a dermoscopic imaging database containing tens of thousands of examples that have confirmed diagnosis and assessment by dermatologists.
            </p>
            
            <p className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
              The AI is able to distinguish between benign and malignant tumors, similar to the ABCDE rule (5 main signs of oncology: asymmetry, boundary, color, diameter, and change over time). The difference between them is that the algorithm can analyze thousands of features, but not only 5 of them. Of course, only a machine can detect that amount of evidence.
            </p>
            
            <p className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
              Due to the productive cooperation with doctors, the quality of the algorithm performance is constantly being improved. Based on growing experience and its own autonomous rules, the AI is able to distinguish between benign and malignant tumors, find risks of human papillomavirus, and classify different types of acne...
            </p>
          </div>
        </div>

      </div>
    </section>
  );
};

export default HowDoesAiAnalyze;