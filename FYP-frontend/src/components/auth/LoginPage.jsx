import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { UserCog, Stethoscope, Sparkles, Lock, Mail, Eye, EyeOff, ArrowLeft, CheckCircle, ShieldCheck, KeyRound } from 'lucide-react';

const LoginPage = () => {
  const navigate = useNavigate();
  const timerRef = useRef(null); // To clean up redirect timeouts cleanly
  
  // --- 💾 SESSION STORAGE STATE INITIALIZATION ---
  const [role, setRole] = useState(() => {
    return sessionStorage.getItem('login_role') || 'ai_derma';
  });
  
  const [email, setEmail] = useState(() => {
    return sessionStorage.getItem('login_email') || '';
  });
  
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false); // Naya password show/hide karne ke liye
  
  // 🚀 SUCCESS POPUP STATES
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [redirectPath, setRedirectPath] = useState('/'); // Kahan bhejna hai save karne ke liye

  // API states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 🚀 FORGOT PASSWORD FLOW STATES (Refresh Safe)
  const [isForgotFlow, setIsForgotFlow] = useState(() => {
    return sessionStorage.getItem('login_is_forgot_flow') === 'true';
  });
  
  const [forgotStep, setForgotStep] = useState(() => {
    const savedStep = sessionStorage.getItem('login_forgot_step');
    return savedStep ? parseInt(savedStep, 10) : 1;
  });
  
  const [forgotEmail, setForgotEmail] = useState(() => {
    return sessionStorage.getItem('login_forgot_email') || '';
  });
  
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotSuccessMsg, setForgotSuccessMsg] = useState(null);

  const roles = [
    { id: 'admin', label: 'Admin', icon: <UserCog size={20} /> },
    { id: 'doctor', label: 'Doctor', icon: <Stethoscope size={20} /> },
    { id: 'ai_derma', label: 'AI User', icon: <Sparkles size={20} /> },
  ];

  // --- 💾 SYNC STATES TO SESSION STORAGE ---
  useEffect(() => {
    sessionStorage.setItem('login_role', role);
  }, [role]);

  useEffect(() => {
    sessionStorage.setItem('login_email', email);
  }, [email]);

  useEffect(() => {
    sessionStorage.setItem('login_is_forgot_flow', isForgotFlow);
  }, [isForgotFlow]);

  useEffect(() => {
    sessionStorage.setItem('login_forgot_step', forgotStep);
  }, [forgotStep]);

  useEffect(() => {
    sessionStorage.setItem('login_forgot_email', forgotEmail);
  }, [forgotEmail]);

  // --- 🌟 AUTO REDIRECT IF ALREADY AUTHENTICATED ---
  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    
    if (token && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        if (parsedUser.role === 'Admin') {
          navigate('/admin-dashboard', { replace: true });
        } else if (parsedUser.role === 'Doctor') {
          navigate('/doctor-dashboard', { replace: true });
        } else {
          navigate('/', { replace: true });
        }
      } catch (err) {
        console.error("Error reading stored credentials", err);
        localStorage.clear();
      }
    }

    // Cleanup timeout on component unmount
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [navigate]);

  // Dynamic helper to get safe current role label
  const getSelectedRoleLabel = () => {
    return roles.find(r => r.id === role)?.label || 'AI User';
  };

  // --- VALIDATION LOGIC ---
  const validateForm = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) {
      setError("Please enter your email address.");
      return false;
    } else if (!emailRegex.test(email)) {
      setError("Please enter a valid email address (e.g., user@gmail.com).");
      return false;
    }

    if (!password) {
      setError("Please enter your password.");
      return false;
    }

    return true;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) return;

    setLoading(true);
    const selectedRoleLabel = getSelectedRoleLabel();

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          email: email, 
          password: password, 
          role: selectedRoleLabel 
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const { token, user } = data.data; // backend generate_response() wraps payload under "data"

        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));

        // Clear all temporary login/forgot states from sessionStorage on successful login
        sessionStorage.removeItem('login_email');
        sessionStorage.removeItem('login_is_forgot_flow');
        sessionStorage.removeItem('login_forgot_step');
        sessionStorage.removeItem('login_forgot_email');

        let path = '/';
        if (user.role === 'Admin') {
          path = '/admin-dashboard';
        } else if (user.role === 'Doctor') {
          path = '/doctor-dashboard';
        }

        setRedirectPath(path);
        setShowSuccessPopup(true);

        timerRef.current = setTimeout(() => {
          navigate(path);
        }, 2500);

      } else {
        setError(data.error || "Invalid email or password!");
      }
    } catch (err) {
      console.error("Login Error:", err);
      setError("Server se connect nahi ho pa raha! Backend check karein.");
    } finally {
      setLoading(false);
    }
  };

  // STEP 1 - REQUEST OTP VIA EMAIL
  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setError(null);
    setForgotSuccessMsg(null);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!forgotEmail) {
      setError("Please enter your registered email address.");
      return;
    } else if (!emailRegex.test(forgotEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setForgotSuccessMsg(data.message || "OTP code sent successfully!");
        setForgotStep(2); // Next step switch
      } else {
        setError(data.error || "Something went wrong.");
      }
    } catch (err) {
      console.error("Forgot Password Step 1 Error:", err);
      setError("Server error. Please check backend network.");
    } finally {
      setLoading(false);
    }
  };

  // STEP 2 - VERIFY OTP AND RESET NEW PASSWORD
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError(null);
    setForgotSuccessMsg(null);

    if (!otp || otp.length < 6) {
      setError("Please enter the complete 6-digit OTP code sent to your email.");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: forgotEmail,
          otp: otp,
          new_password: newPassword
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setForgotSuccessMsg("Password reset successfully! You can now login.");
        
        // Form field states clean
        setEmail(forgotEmail);
        setPassword('');
        setOtp('');
        setNewPassword('');
        
        // Clear forgot-flow session states
        sessionStorage.removeItem('login_is_forgot_flow');
        sessionStorage.removeItem('login_forgot_step');
        sessionStorage.removeItem('login_forgot_email');

        // 2 seconds baad login form par wapis bhejein
        timerRef.current = setTimeout(() => {
          setIsForgotFlow(false);
          setForgotStep(1);
          setForgotSuccessMsg(null);
          setError(null);
        }, 2000);

      } else {
        setError(data.error || "Invalid OTP code or password reset failed.");
      }
    } catch (err) {
      console.error("Forgot Password Step 2 Error:", err);
      setError("Server error during password reset.");
    } finally {
      setLoading(false);
    }
  };

  const resetToLoginFlow = () => {
    setIsForgotFlow(false);
    setForgotStep(1);
    setForgotEmail('');
    setError(null);
    setForgotSuccessMsg(null);
    sessionStorage.removeItem('login_is_forgot_flow');
    sessionStorage.removeItem('login_forgot_step');
    sessionStorage.removeItem('login_forgot_email');
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6 font-sans relative overflow-hidden pt-24 pb-12">
      
      {/* 🚀 SUCCESS POPUP OVERLAY AND MODAL */}
      {showSuccessPopup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0c2b5e]/40 backdrop-blur-md animate-fadeIn">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] text-center relative overflow-hidden animate-popIn">
            
            {/* Top Gradient Border */}
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 via-[#3fd5c2] to-teal-400"></div>
            
            {/* Animated Icon Circle */}
            <div className="w-24 h-24 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner relative">
              <div className="absolute inset-0 bg-[#3fd5c2] rounded-full animate-ping opacity-20"></div>
              <CheckCircle size={48} className="text-[#3fd5c2] animate-bounce" />
            </div>
            
            <h3 className="text-2xl font-black text-[#0c2b5e] mb-2 tracking-tight">Login Successful!</h3>
            <p className="text-gray-500 text-sm mb-8 font-medium leading-relaxed">
              Welcome back! Redirecting you to your {getSelectedRoleLabel()} dashboard...
            </p>
            
            <button 
              onClick={() => {
                if (timerRef.current) clearTimeout(timerRef.current);
                navigate(redirectPath);
              }}
              className="w-full bg-gradient-to-r from-[#0c2b5e] to-blue-900 hover:from-blue-900 hover:to-[#0c2b5e] text-white font-bold py-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 active:scale-95 flex items-center justify-center gap-2 group"
            >
              Go to Dashboard <ArrowLeft className="rotate-180 group-hover:translate-x-1 transition-transform" size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Back Button */}
      <button 
        onClick={() => {
          if (isForgotFlow) {
            resetToLoginFlow();
          } else {
            navigate(-1);
          }
        }}
        className="absolute top-8 left-6 md:left-12 flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-md border border-slate-200 text-slate-600 rounded-full font-bold text-sm hover:bg-slate-50 hover:text-[#0c2b5e] hover:shadow-md transition-all duration-300 z-50 group"
      >
        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
        {isForgotFlow ? "Back to Login" : "Back"}
      </button>

      {/* Decorative Background Elements */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-[#3fd5c2] to-purple-500"></div>
      <div className="absolute top-20 left-10 w-64 h-64 bg-blue-50 rounded-full blur-3xl opacity-60"></div>
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-cyan-50 rounded-full blur-3xl opacity-60"></div>

      <div className="w-full max-w-[450px] relative z-10">
        <div className="text-center mb-10">
          <h1 className="text-[#0c2b5e] text-3xl font-black tracking-tight mb-2">
            AI DERMATOLOGIST
          </h1>
          <p className="text-gray-500 font-medium">
            {isForgotFlow ? "Reset account password securely" : "Please select your portal to continue"}
          </p>
        </div>

        <div className="bg-white border border-slate-100 shadow-2xl rounded-[2.5rem] p-8 md:p-10">
          
          {/* Role Selector Only visible when not in forgot password flow */}
          {!isForgotFlow && (
            <div className="flex bg-slate-50 p-1.5 rounded-2xl mb-6">
              {roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setRole(r.id);
                    setError(null);
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all duration-300 font-bold text-sm ${
                    role === r.id 
                    ? 'bg-white text-[#0c2b5e] shadow-md' 
                    : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {r.icon}
                  <span className="hidden sm:inline">{r.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 text-red-500 p-3 rounded-xl mb-4 text-sm font-bold text-center border border-red-100 animate-fadeIn">
              ⚠️ {error}
            </div>
          )}

          {/* Success Notification for Forgot Flow */}
          {forgotSuccessMsg && (
            <div className="bg-emerald-50 text-emerald-600 p-3 rounded-xl mb-4 text-sm font-bold text-center border border-emerald-100 animate-fadeIn flex items-center justify-center gap-2">
              <ShieldCheck size={18} /> {forgotSuccessMsg}
            </div>
          )}

          {/* ==========================================
              🔄 CONDITIONAL RENDERING: LOGIN VS FORGOT FLOW
              ========================================== */}
          
          {!isForgotFlow ? (
            /* ---- NORMAL LOGIN FORM ---- */
            <form onSubmit={handleLogin} className="space-y-6">
              {/* Email Field */}
              <div className="space-y-2">
                <label htmlFor="login-email" className="text-sm font-bold text-[#0c2b5e] ml-1">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input 
                    id="login-email"
                    type="email" 
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError(null);
                    }}
                    placeholder="name@gmail.com"
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-transparent focus:border-[#3fd5c2] focus:bg-white rounded-2xl outline-none transition-all text-slate-800"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1">
                  <label htmlFor="login-password" className="text-sm font-bold text-[#0c2b5e]">Password</label>
                  <button 
                    type="button"
                    onClick={() => {
                      setIsForgotFlow(true);
                      setForgotStep(1);
                      setForgotEmail(email); // Jo email likha ho wo carry pass ho jaye
                      setError(null);
                    }}
                    className="text-xs font-bold text-[#3fd5c2] hover:underline bg-transparent border-none outline-none"
                  >
                    Forgot?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input 
                    id="login-password"
                    type={showPassword ? "text" : "password"} 
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError(null);
                    }}
                    placeholder="••••••••"
                    className="w-full pl-12 pr-12 py-4 bg-slate-50 border border-transparent focus:border-[#3fd5c2] focus:bg-white rounded-2xl outline-none transition-all text-slate-800"
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button 
                type="submit" 
                disabled={loading}
                className={`w-full text-white font-bold py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-3 group
                  ${loading ? 'bg-slate-400 cursor-not-allowed' : 'bg-[#0c2b5e] hover:bg-[#163a75] shadow-blue-900/20 active:scale-95'}`}
              >
                {loading ? "Logging in..." : `Login to ${getSelectedRoleLabel()} Portal`}
                {!loading && (
                  <div className="w-6 h-6 bg-white/10 rounded-full flex items-center justify-center group-hover:translate-x-1 transition-transform">
                    →
                  </div>
                )}
              </button>
            </form>
          ) : (
            /* ---- FORGOT PASSWORD MULTI-STEP FORM ---- */
            <div>
              {forgotStep === 1 ? (
                /* Step 1: Send OTP Email Form */
                <form onSubmit={handleRequestOtp} className="space-y-6 animate-fadeIn">
                  <div className="space-y-2">
                    <label htmlFor="forgot-email" className="text-sm font-bold text-[#0c2b5e] ml-1">Account Registered Email</label>
                    <p className="text-xs text-gray-400 mb-2 ml-1">Hum aapke email address par password reset ke liye verification OTP code bhejenge.</p>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                      <input 
                        id="forgot-email"
                        type="email" 
                        autoComplete="email"
                        value={forgotEmail}
                        onChange={(e) => {
                          setForgotEmail(e.target.value);
                          setError(null);
                        }}
                        placeholder="your-email@gmail.com"
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-transparent focus:border-[#3fd5c2] focus:bg-white rounded-2xl outline-none transition-all text-slate-800"
                      />
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={loading}
                    className={`w-full text-white font-bold py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-3 group
                      ${loading ? 'bg-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-[#3fd5c2] to-teal-500 hover:shadow-xl active:scale-95'}`}
                  >
                    {loading ? "Sending Code..." : "Send Verification OTP"}
                    {!loading && <KeyRound size={18} />}
                  </button>

                  <button
                    type="button"
                    onClick={resetToLoginFlow}
                    className="w-full text-center text-xs font-bold text-[#0c2b5e] hover:underline pt-2 block"
                  >
                    Nevermind, back to Login Form
                  </button>
                </form>
              ) : (
                /* Step 2: Enter OTP Code & Enter New Password Form */
                <form onSubmit={handleResetPassword} className="space-y-6 animate-fadeIn">
                  {/* OTP Code Field */}
                  <div className="space-y-2">
                    <label htmlFor="otp-input" className="text-sm font-bold text-[#0c2b5e] ml-1">Enter 6-Digit OTP</label>
                    <div className="relative">
                      <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                      <input 
                        id="otp-input"
                        type="text" 
                        maxLength={6}
                        value={otp}
                        onChange={(e) => {
                          setOtp(e.target.value.replace(/\D/g, '')); // Only digits allowed
                          setError(null);
                        }}
                        placeholder="123456"
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-transparent focus:border-[#3fd5c2] focus:bg-white rounded-2xl outline-none transition-all text-slate-800 tracking-widest text-lg font-black"
                      />
                    </div>
                  </div>

                  {/* New Password Field */}
                  <div className="space-y-2">
                    <label htmlFor="reset-new-password" className="text-sm font-bold text-[#0c2b5e] ml-1">Create New Password</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                      <input 
                        id="reset-new-password"
                        type={showNewPassword ? "text" : "password"} 
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => {
                          setNewPassword(e.target.value);
                          setError(null);
                        }}
                        placeholder="Min 6 characters"
                        className="w-full pl-12 pr-12 py-4 bg-slate-50 border border-transparent focus:border-[#3fd5c2] focus:bg-white rounded-2xl outline-none transition-all text-slate-800"
                      />
                      <button 
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={loading}
                    className={`w-full text-white font-bold py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-3 group
                      ${loading ? 'bg-slate-400 cursor-not-allowed' : 'bg-[#0c2b5e] hover:bg-[#163a75] shadow-blue-900/20 active:scale-95'}`}
                  >
                    {loading ? "Updating Password..." : "Update & Reset Password"}
                    {!loading && <CheckCircle size={18} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setForgotStep(1);
                      setError(null);
                      setForgotSuccessMsg(null);
                    }}
                    className="w-full text-center text-xs font-bold text-gray-400 hover:text-gray-600 hover:underline pt-2 block"
                  >
                    Wrong Email? Change email address
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Registration Link */}
          <div className="mt-8 pt-6 border-t border-slate-50 text-center">
            <p className="text-sm text-gray-500">
              Don't have an account?{' '}
              <Link to="/register" className="text-[#3fd5c2] font-bold hover:underline">
                Create Account
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center mt-8 text-xs text-gray-400 font-medium">
          Protected by AI-Derm Security. Need help? <span className="text-gray-600 underline cursor-pointer">Contact Support</span>
        </p>
      </div>
      
      {/* 🚀 CSS ANIMATIONS */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out forwards; }

        @keyframes popIn { 
          0% { opacity: 0; transform: scale(0.8) translateY(20px); } 
          100% { opacity: 1; transform: scale(1) translateY(0); } 
        }
        .animate-popIn { animation: popIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}} />
    </div>
  );
};

export default LoginPage;