import React, { useState, useEffect, useRef } from 'react';
import { Settings, LogOut, Camera, X, Loader, User, Building, MapPin, Phone, BadgeCheck, ShieldAlert, Clock3 } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

const HeaderProfileDropdown = ({ currentUser, onLogout, API_BASE_URL }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Naye fields shamil kiye gaye hain
  const [formData, setFormData] = useState({
    name: currentUser?.name || '',
    email: currentUser?.email || '',
    specialization: '',
    experience: '',
    hospital: '',
    city: '',
    phone: '',
    license: '', // Agar license edit nahi karna to ise readOnly bana sakte hain
  });

  // Admin ne license verify kiya ya nahi: 'pending' | 'approved' | 'rejected'
  const [verificationStatus, setVerificationStatus] = useState('pending');
  const [verificationNote, setVerificationNote] = useState('');

  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [imageError, setImageError] = useState(false);

  // Helper to extract first letter safely
  const getInitials = (name) => {
    return name ? name.charAt(0).toUpperCase() : 'D';
  };

  // Admin license verification badge — teen states: approved / pending / rejected
  const renderVerificationBadge = (compact = false) => {
    if (verificationStatus === 'approved') {
      return (
        <span className={`inline-flex items-center gap-1 ${compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'} rounded-full font-black uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200`}>
          <BadgeCheck size={compact ? 10 : 12} /> Verified
        </span>
      );
    }
    if (verificationStatus === 'rejected') {
      return (
        <span className={`inline-flex items-center gap-1 ${compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'} rounded-full font-black uppercase tracking-wide bg-rose-50 text-rose-700 border border-rose-200`}>
          <ShieldAlert size={compact ? 10 : 12} /> Not Verified
        </span>
      );
    }
    // pending (default)
    return (
      <span className={`inline-flex items-center gap-1 ${compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'} rounded-full font-black uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-200`}>
        <Clock3 size={compact ? 10 : 12} /> Pending Verification
      </span>
    );
  };

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') setModalOpen(false); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  // BUG FIX: dropdown pehle sirf onMouseEnter/onMouseLeave (hover) se control
  // hota tha — touch screens (mobile/tablet) par hover exist hi nahi karta,
  // isliye "Edit Profile" aur "Logout" dono completely unreachable the. Ab
  // trigger button pe onClick toggle hai (touch-friendly), aur ye effect
  // bahar tap/click hone par dropdown ko close kar deta hai — jo pehle
  // sirf onMouseLeave se hota tha (jo touch pe fire hi nahi hota).
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [dropdownOpen]);

  const fetchFullProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const res = await fetch(`${API_BASE_URL}/api/doctor/profile`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await res.json();

      if (result.success && result.data) {
        const profile = result.data;
        setFormData({
          name: profile.name || currentUser?.name || '',
          email: profile.email || currentUser?.email || '',
          specialization: profile.specialty || profile.specialization || '',
          experience: profile.experience || '',
          hospital: profile.hospital || '',
          city: profile.city || '',
          phone: profile.phone || '',
          license: profile.license || '', 
        });

        setVerificationStatus(profile.verification_status || 'pending');
        setVerificationNote(profile.verification_note || '');

        if (profile.profile_image) {
          const imagePath = profile.profile_image.startsWith('/') 
            ? profile.profile_image 
            : `/${profile.profile_image}`;
          setPreviewUrl(`${API_BASE_URL}${imagePath}?t=${Date.now()}`);
          setImageError(false);
        }
      }
    } catch (error) {
      console.error("Profile fetch error:", error);
    }
  };

  useEffect(() => {
    fetchFullProfile();
  }, [currentUser, API_BASE_URL]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error("File size bohot zyada hai! 2MB se choti image select karein.");
        return;
      }
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setImageError(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const data = new FormData();
      
      data.append('name', formData.name);
      data.append('email', formData.email);
      data.append('specialty', formData.specialization);
      data.append('experience', formData.experience);
      data.append('hospital', formData.hospital);
      data.append('city', formData.city);
      data.append('phone', formData.phone);
      data.append('license', formData.license);
      // Data append karke server bhejein
      
      if (imageFile) {
        data.append('profile_image', imageFile);
      }

      const response = await fetch(`${API_BASE_URL}/api/doctor/profile`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: data
      });

      const result = await response.json();
      if (result.success) {
        toast.success('Profile updated!');
        setModalOpen(false);
        setTimeout(() => window.location.reload(), 1000);
      } else {
        toast.error(result.error || 'Update failed!');
      }
    } catch (error) {
      console.error("Error:", error);
      toast.error('Server error! Check console.');
    } finally {
      setLoading(false);
    }
  };

  // Safe fallback UI component (No External Images)
  const renderAvatar = (sizeClasses = "w-10 h-10") => {
    if (previewUrl && !imageError) {
      return (
        <img 
          src={previewUrl} 
          alt="Profile" 
          className={`${sizeClasses} rounded-full object-cover border-2 border-emerald-500 shadow-sm bg-white`}
          onError={() => setImageError(true)} 
        />
      );
    }
    
    return (
      <div className={`${sizeClasses} rounded-full border-2 border-emerald-500 bg-emerald-100 flex items-center justify-center shadow-sm`}>
        <span className="text-emerald-700 font-black text-lg">
          {getInitials(formData.name)}
        </span>
      </div>
    );
  };

  return (
    <div 
      className="relative" 
      ref={dropdownRef}
    >
      <Toaster position="top-right" />

      {/* Trigger Button */}
      <button 
        type="button"
        onClick={() => setDropdownOpen(prev => !prev)}
        className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-slate-100 transition-all focus:outline-none cursor-pointer border-none bg-transparent"
      >
        {renderAvatar("w-10 h-10")}
        <div className="text-left hidden md:block">
          <p className="text-xs font-black text-slate-700 m-0 leading-tight">Dr. {formData.name || 'Profile'}</p>
          <div className="mt-0.5">{renderVerificationBadge(true)}</div>
        </div>
      </button>

      {/* Hover Dropdown */}
      {dropdownOpen && (
        <div className="absolute right-0 top-full pt-1 w-48 z-[999] animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 py-2">
            <button onClick={() => { setModalOpen(true); setDropdownOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-emerald-600 transition-all text-left border-none bg-transparent cursor-pointer">
              <Settings size={14} /> Edit Profile Settings
            </button>
            <hr className="border-slate-100 my-1" />
            <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-rose-600 hover:bg-rose-50 transition-all text-left border-none bg-transparent cursor-pointer">
              <LogOut size={14} /> Logout Account
            </button>
          </div>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl scale-in animate-in duration-200 overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-black text-slate-800 m-0">Edit Doctor Profile</h3>
              <button onClick={() => setModalOpen(false)} className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 border-none bg-transparent cursor-pointer">
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-4 text-left">
              <div className="flex flex-col items-center justify-center bg-slate-50 p-4 rounded-2xl border border-dashed border-slate-200">
                <div className="relative group">
                  {renderAvatar("w-20 h-20")}
                  <label htmlFor="profile-upload" className="absolute bottom-0 right-0 bg-emerald-500 text-white p-2 rounded-full shadow-md cursor-pointer hover:bg-emerald-600 transition-all flex items-center justify-center">
                    <Camera size={14} />
                  </label>
                  <input id="profile-upload" type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                </div>
                <span className="text-[10px] text-slate-400 mt-2 font-bold">Photo tabdeel karne ke liye click karein</span>
              </div>
              
              {/* Form Grid Layout for better spacing */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-[11px] font-black text-slate-600 mb-1">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input type="text" name="name" value={formData.name} onChange={handleInputChange} required className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-emerald-500 font-medium" />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-600 mb-1">Specialization</label>
                  <input type="text" name="specialization" value={formData.specialization} onChange={handleInputChange} placeholder="e.g. Dermatologist" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-emerald-500 font-medium" />
                </div>
                
                <div>
                  <label className="block text-[11px] font-black text-slate-600 mb-1">Experience (Years)</label>
                  <input type="number" name="experience" value={formData.experience} onChange={handleInputChange} placeholder="e.g. 5" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-emerald-500 font-medium" />
                </div>

                <div className="col-span-1 md:col-span-2">
                  <label className="block text-[11px] font-black text-slate-600 mb-1">Clinic/Hospital Name</label>
                  <div className="relative">
                    <Building className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input type="text" name="hospital" value={formData.hospital} onChange={handleInputChange} placeholder="e.g. General Hospital" className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-emerald-500 font-medium" />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-600 mb-1">City</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input type="text" name="city" value={formData.city} onChange={handleInputChange} placeholder="e.g. Lahore" className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-emerald-500 font-medium" />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-600 mb-1">Phone Number</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input 
                      type="text" 
                      name="phone" 
                      value={formData.phone} 
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        if(val.length <= 11) handleInputChange({target: {name: 'phone', value: val}});
                      }}
                      placeholder="03001234567" 
                      className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-emerald-500 font-medium" 
                    />
                  </div>
                </div>

                <div className="col-span-1 md:col-span-2 pt-2 border-t border-slate-100 space-y-1.5">
                   <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                     <label className="block text-[11px] font-black text-slate-600 m-0">PMDC License Number</label>
                     {renderVerificationBadge(false)}
                   </div>
                   <div className="relative">
                     <BadgeCheck className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                     <input
                       type="text"
                       name="license"
                       value={formData.license}
                       onChange={handleInputChange}
                       placeholder="e.g. PMDC-12345"
                       className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs uppercase focus:outline-none focus:border-emerald-500 font-medium"
                     />
                   </div>

                   {!formData.license && (
                     <p className="text-[10px] text-slate-400 font-medium m-0">
                       Add your license number so admin can verify your account.
                     </p>
                   )}
                   {verificationStatus === 'approved' && formData.license && (
                     <p className="text-[10px] text-slate-400 font-medium m-0">
                       Changing this number will send your account back for re-verification.
                     </p>
                   )}
                   {verificationStatus === 'pending' && (
                     <p className="text-[10px] text-amber-600 font-medium m-0 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                       Your license is under review by our admin team. You can use your account normally, but patients will see a "Pending Verification" badge on your profile until this is approved.
                     </p>
                   )}
                   {verificationStatus === 'rejected' && (
                     <p className="text-[10px] text-rose-600 font-medium m-0 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5">
                       We couldn't verify your license{verificationNote ? `: ${verificationNote}` : '.'} Please contact support if you believe this is a mistake.
                     </p>
                   )}
                </div>
              </div>
              
              <div className="flex gap-2 pt-4">
                <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-all text-xs border-none cursor-pointer">Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-all shadow-sm text-xs flex items-center justify-center gap-2 border-none cursor-pointer">
                  {loading ? <Loader size={14} className="animate-spin" /> : 'Save Profile Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default HeaderProfileDropdown;