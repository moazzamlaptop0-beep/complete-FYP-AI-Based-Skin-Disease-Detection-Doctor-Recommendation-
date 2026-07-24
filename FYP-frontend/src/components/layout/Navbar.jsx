import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  ScanFace, Globe, HelpCircle, UserPlus, 
  LogIn, LogOut, FileText, LayoutDashboard 
} from 'lucide-react';

const Navbar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const { t, i18n } = useTranslation();

  // Check login status on load and route change
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    } else {
      setUser(null);
    }
  }, [location]);

  // Logout function
  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');

    // Clear any cached scan data so the next logged-in user doesn't see it
    sessionStorage.removeItem('cached_image_base64');
    sessionStorage.removeItem('cached_image_name');
    sessionStorage.removeItem('cached_image_type');
    sessionStorage.removeItem('lastScanResult');

    setUser(null);
    navigate('/login');
  };

  // Language Toggle Function
  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'ur' : 'en';
    i18n.changeLanguage(newLang);
    document.documentElement.dir = newLang === 'ur' ? 'rtl' : 'ltr';
  };

  return (
    <header className="fixed top-0 left-0 w-full h-20 bg-white/80 backdrop-blur-md border-b border-slate-200/60 z-50 px-6 md:px-16 flex items-center justify-between shadow-[0_2px_12px_rgba(0,0,0,0.01)] font-sans">
      
      {/* BRANDING SECTION: Perfect High-Contrast Layout */}
      <Link to="/" className="flex items-center gap-3 group cursor-pointer">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 shadow-sm flex items-center justify-center text-white transition-transform group-hover:scale-102">
          <ScanFace size={22} />
        </div>
        <div className="flex flex-col">
          <span className="text-slate-900 font-bold text-base tracking-tight leading-tight group-hover:text-indigo-600 transition-colors">
            Derma AI
          </span>
          <span className="text-slate-500 font-medium text-[11px] tracking-wide">
            Skin Scanner
          </span>
        </div>
      </Link>
      
      {/* INTERACTIVE ACTIONS PANEL */}
      <div className="flex items-center gap-4">
        
        {/* Elegant Language Selection Pill */}
        <button 
          onClick={toggleLanguage}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 transition-all text-xs font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
        >
          <Globe size={14} className="text-emerald-600" />
          <span>{i18n.language === 'en' ? 'Urdu' : 'English'}</span>
        </button>

        {/* Corporate Separator Splice */}
        <div className="h-5 w-px bg-slate-200 mx-1 hidden sm:block"></div>

        {/* Navigation Action Group */}
        <div className="flex items-center gap-3">
          
          {/* FAQ Icon Action */}
          <Link 
            to="/faq" 
            title={t('faq')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
              location.pathname === '/faq' 
                ? 'text-indigo-600 bg-indigo-50/60' 
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <HelpCircle size={20} />
          </Link>

          {/* Conditional Layout Injection: Auth Dependent */}
          {user ? (
            <>
              {/* Contextual Reports/Dashboard Link */}
              <Link 
                to={user.role === 'Doctor' ? '/doctor-dashboard' : '/my-reports'} 
                title={user.role === 'Doctor' ? t('dashboard') : t('my_reports')}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                  location.pathname === '/doctor-dashboard' || location.pathname === '/my-reports'
                    ? 'text-indigo-600 bg-indigo-50/60' 
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {user.role === 'Doctor' ? <LayoutDashboard size={20} /> : <FileText size={20} />}
              </Link>

              {/* Secure App Session Disposal */}
              <button 
                onClick={handleLogout}
                title={t('logout')}
                className="w-9 h-9 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50/60 flex items-center justify-center transition-all outline-none"
              >
                <LogOut size={19} />
              </button>
            </>
          ) : (
            <>
              {/* Account Onboarding Entrypoint */}
              <Link 
                to="/register" 
                title={t('register')}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                  location.pathname === '/register' 
                    ? 'text-indigo-600 bg-indigo-50/60' 
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <UserPlus size={20} />
              </Link>

              {/* Secure Credentials Gate */}
              <Link 
                to="/login" 
                title={t('login')}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                  location.pathname === '/login' 
                    ? 'text-indigo-600 bg-indigo-50/60' 
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <LogIn size={20} />
              </Link>
            </>
          )}

        </div>
      </div>
    </header>
  );
};

export default Navbar;