import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';

// ==========================================
// 1. COMPONENTS FOLDER IMPORTS (All nested under components/)
// ==========================================
import Navbar from "./components/layout/Navbar";
import Hero from './components/landing/Hero';
import FeaturesMarquee from './components/landing/FeaturesMarquee'; 
import ConditionAnalysis from './components/landing/ConditionAnalysis';
import LifeSavingDataView from './components/landing/LifeSavingDataView';
import WhyUseAiDermatologist from './components/landing/WhyUseAiDermatologist';
import HowToUseAiDermatologist from './components/landing/HowToUseAiDermatologist'; 
import HowDoesAiAnalyze from './components/landing/HowDoesAiAnalyze';
import Footer from './components/layout/Footer';
import FloatingChatbot from './components/widgets/FloatingChatbot'; 
import NearbyDoctors from "./components/doctor-directory/NearbyDoctors"; 

import ProtectedRoute from './components/auth/ProtectedRoute'; 
import LoginPage from './components/auth/LoginPage'; 
import RegisterPage from './components/auth/RegisterPage'; 
import TryNowPage from './components/ai-features/TryNowPage'; 
import AdminDashboard from "./components/dashboards/admin/AdminDashboard";
import DoctorDashboard from "./components/dashboards/doctor/DoctorDashboard"; 
import PatientHistory from "./components/dashboards/patient/PatientHistory"; 

// ==========================================
// 2. PAGES IMPORTS (Root level pages/ folder)
// ==========================================
import FAQ from './pages/FAQ';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfUse from './pages/TermsOfUse';
import NotFound from './pages/NotFound'; 

// Helper: Page change par scroll hamesha top par le jaane ke liye
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

function AppContent() {
  const location = useLocation();
  
  // Base paths jahan Layout (Navbar/Footer) nahi dikhana
  const noLayoutPages = [
    '/try-now', 
    '/admin-dashboard', 
    '/doctor-dashboard', 
    '/login', 
    '/register',
    '/nearby-doctors' 
  ];

  // FIX: .some() aur .startsWith() use kiya hai taake nested URLs (e.g., /doctor-dashboard/ratings) par bhi layout hide rahe
  const hideLayout = noLayoutPages.some(path => location.pathname.startsWith(path));

  // Layout ki dynamic styling
  const mainClass = hideLayout 
    ? "flex-grow w-full" 
    : "flex-grow min-h-screen bg-gradient-to-b from-[#0b1b3d] via-[#06142e] to-[#020813] text-white font-sans flex flex-col";

  return (
    <div className={hideLayout ? "flex flex-col min-h-screen bg-[#0c2b5e]" : mainClass}>
      <ScrollToTop />
      
      {/* Navbar sirf tab dikhega jab dashboard ya login/reg na ho */}
      {!hideLayout && <Navbar />}
      
      <main className="flex-grow">
        <Routes>
          {/* ==========================================
              1. PUBLIC ROUTES (Landing Page)
             ========================================== */}
          <Route path="/" element={
            <>
              <Hero />
              <FeaturesMarquee />
              <ConditionAnalysis />
              <LifeSavingDataView />
              <WhyUseAiDermatologist />
              <HowToUseAiDermatologist />
              <HowDoesAiAnalyze />
            </>
          } />

          {/* ==========================================
              2. INFO PAGES ROUTES
             ========================================== */}
          <Route path="/faq" element={<FAQ />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-of-use" element={<TermsOfUse />} />

          {/* ==========================================
              3. AUTHENTICATION ROUTES
             ========================================== */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          
          {/* ==========================================
              4. PROTECTED / FEATURE ROUTES
             ========================================== */}
          
          {/* AI Scanner Page */}
          <Route path="/try-now" element={<TryNowPage />} />

          {/* Map Page: Nearby Doctors */}
          <Route path="/nearby-doctors" element={<NearbyDoctors />} /> 
          
          {/* Patient History / Reports Page (Added /* for Nested Routing) */}
          <Route path="/my-reports/*" element={
            <ProtectedRoute allowedRole="AI User">
              <PatientHistory />
            </ProtectedRoute>
          } />
          
          {/* Admin Dashboard (Added /* for Nested Routing) */}
          <Route path="/admin-dashboard/*" element={
            <ProtectedRoute allowedRole="Admin">
              <AdminDashboard />
            </ProtectedRoute>
          } />
          
          {/* Doctor Dashboard (Added /* for Nested Routing) */}
          <Route path="/doctor-dashboard/*" element={
            <ProtectedRoute allowedRole="Doctor">
              <DoctorDashboard />
            </ProtectedRoute>
          } />

          {/* ==========================================
              5. 404 CATCH-ALL ROUTE
             ========================================== */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      {!hideLayout && <Footer />}

      {/* GLOBAL FLOATING CHATBOT */}
      <FloatingChatbot />

    </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;