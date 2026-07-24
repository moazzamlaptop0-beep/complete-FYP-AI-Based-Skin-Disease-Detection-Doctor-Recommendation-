import React, { useState, useEffect } from 'react';
import { Users, Scan, Activity, LogOut, Stethoscope, BadgeCheck, ShieldAlert, Clock3, Trash2, Mail, MapPin, Building, Phone, X, Loader } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';

const API_BASE_URL = import.meta.env.VITE_API_URL;

const AdminDashboard = () => {
  const [stats, setStats] = useState({ total_users: 0, total_scans: 0, total_doctors: 0, pending_doctor_verifications: 0 });
  const [loading, setLoading] = useState(true); // Page refresh par khali/zero na dikhe isliye loading state
  const navigate = useNavigate();

  // --- Doctor Verification View State ---
  const [activeView, setActiveView] = useState('overview'); // 'overview' | 'doctors'
  const [doctors, setDoctors] = useState([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending'); // 'pending' | 'approved' | 'rejected' | 'all'
  const [actionLoadingId, setActionLoadingId] = useState(null); // doctor id currently being approved/rejected/deleted
  const [rejectModalDoctor, setRejectModalDoctor] = useState(null);
  const [rejectNote, setRejectNote] = useState('');
  const [deleteConfirmDoctor, setDeleteConfirmDoctor] = useState(null);

  const getToken = () => localStorage.getItem('token');

  useEffect(() => {
    // 1. Security Check: Dekho ke kya browser mein 'user' aur 'token' dono majood hain
    const storedUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');

    if (!storedUser || !token) {
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      navigate('/login');
      return;
    }
    
    try {
      const parsedUser = JSON.parse(storedUser);
      if (parsedUser.role !== 'Admin') {
        navigate('/login'); // Agar role Admin nahi hai toh nikal do
        return;
      }
    } catch (e) {
      localStorage.clear();
      navigate('/login');
      return;
    }

    // 2. Data Fetching with Authorization Token
    setLoading(true);
    fetch(`${import.meta.env.VITE_API_URL}/admin/stats`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}` // Token bhej rahe hain backend ko verify karne ke liye
      }
    })
      .then(res => {
        // Agar backend token reject karey (401/403), toh dashboard khali kar ke login page pe bhejo
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem('user');
          localStorage.removeItem('token');
          navigate('/login');
          throw new Error("Session invalid or unauthorized!");
        }
        return res.json();
      })
      .then(result => {
        // BUG FIX: backend ka generate_response() stats ko top-level par nahi,
        // "data" key ke andar wrap kar ke bhejta hai ({ success, data: {...} }).
        // Pehle yahan seedha `data.total_users` waghera padha ja raha tha, jo
        // hamesha undefined hota tha isliye `|| 0` fallback fire ho jata tha
        // aur dashboard hamesha 0/0/0/0 dikhata tha, chahe DB me real data ho.
        if (result.success === false) {
          toast.error(result.error || 'Could not load dashboard stats');
          return;
        }
        const s = result.data || {};
        setStats({
          total_users: s.total_users || 0,
          total_doctors: s.total_doctors || 0,
          total_scans: s.total_scans || 0,
          pending_doctor_verifications: s.pending_doctor_verifications || 0
        });
      })
      .catch(err => console.error("Error fetching stats:", err))
      .finally(() => {
        setLoading(false); // Data fetch hone ke baad loading khatam
      });
  }, [navigate]);

  // 3. Fetch doctors list whenever the verification tab is opened or filter changes
  useEffect(() => {
    if (activeView !== 'doctors') return;

    const token = getToken();
    if (!token) return;

    setDoctorsLoading(true);
    const query = statusFilter === 'all' ? '' : `?status=${statusFilter}`;

    fetch(`${API_BASE_URL}/admin/doctors${query}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          setDoctors(result.data || []);
        } else {
          toast.error(result.error || 'Could not load doctors');
        }
      })
      .catch(err => {
        console.error('Fetch doctors error:', err);
        toast.error('Server error while loading doctors');
      })
      .finally(() => setDoctorsLoading(false));
  }, [activeView, statusFilter]);

  const refreshDoctorsAndStats = () => {
    // BUG FIX (dead-code cleanup): pehle yahan "setStatusFilter(prev => prev)"
    // tha, jiska comment kehta tha ke ye "filter ko nudge karke effect
    // re-trigger karega" - lekin React same-value state update par re-render
    // trigger hi nahi karta, isliye ye line kabhi kuch nahi karti thi
    // (no-op). Neeche wali dono fetch calls (doctors + stats) hi actual kaam
    // kar rahi hain, isliye function ka result pehle bhi sahi tha - bas ye
    // misleading dead line hata di.
    const token = getToken();
    if (!token) return;

    const query = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
    fetch(`${API_BASE_URL}/admin/doctors${query}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(result => { if (result.success) setDoctors(result.data || []); })
      .catch(() => {});

    fetch(`${API_BASE_URL}/admin/stats`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(result => {
        // BUG FIX: same "data" wrapper issue as the initial stats load above -
        // real values sit under result.data, not on the response root.
        if (!result.success) return;
        const s = result.data || {};
        setStats(prev => ({
          ...prev,
          pending_doctor_verifications: s.pending_doctor_verifications || 0,
          total_doctors: s.total_doctors || prev.total_doctors
        }));
      })
      .catch(() => {});
  };

  const handleApprove = (doctor) => {
    setActionLoadingId(doctor.id);
    const token = getToken();
    fetch(`${API_BASE_URL}/admin/doctors/${doctor.id}/verify`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'approve' })
    })
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          toast.success(`Dr. ${doctor.name} approved!`);
          refreshDoctorsAndStats();
        } else {
          toast.error(result.error || 'Approval failed');
        }
      })
      .catch(() => toast.error('Server error while approving'))
      .finally(() => setActionLoadingId(null));
  };

  const confirmReject = () => {
    if (!rejectModalDoctor) return;
    const doctor = rejectModalDoctor;
    setActionLoadingId(doctor.id);
    const token = getToken();
    fetch(`${API_BASE_URL}/admin/doctors/${doctor.id}/verify`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'reject', note: rejectNote })
    })
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          toast.success(`Dr. ${doctor.name} marked as rejected`);
          setRejectModalDoctor(null);
          setRejectNote('');
          refreshDoctorsAndStats();
        } else {
          toast.error(result.error || 'Rejection failed');
        }
      })
      .catch(() => toast.error('Server error while rejecting'))
      .finally(() => setActionLoadingId(null));
  };

  const confirmDelete = () => {
    if (!deleteConfirmDoctor) return;
    const doctor = deleteConfirmDoctor;
    setActionLoadingId(doctor.id);
    const token = getToken();
    fetch(`${API_BASE_URL}/admin/doctors/${doctor.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          toast.success(`Dr. ${doctor.name}'s account deleted`);
          setDeleteConfirmDoctor(null);
          setDoctors(prev => prev.filter(d => d.id !== doctor.id));
          refreshDoctorsAndStats();
        } else {
          toast.error(result.error || 'Delete failed');
        }
      })
      .catch(() => toast.error('Server error while deleting'))
      .finally(() => setActionLoadingId(null));
  };

  const StatusPill = ({ status }) => {
    if (status === 'approved') {
      return (
        <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wide">
          <BadgeCheck size={12} /> Approved
        </span>
      );
    }
    if (status === 'rejected') {
      return (
        <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wide">
          <ShieldAlert size={12} /> Rejected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wide">
        <Clock3 size={12} /> Pending
      </span>
    );
  };

  // 4. Logout handler ab user data ke sath token ko bhi local storage se uraye ga
  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex font-sans">
      {/* Sidebar */}
      <div className="w-64 bg-[#0c2b5e] text-white p-6 shadow-xl flex flex-col">
        <h2 className="text-2xl font-black mb-10 tracking-tight">ADMIN PANEL</h2>
        <nav className="space-y-4 flex-1">
          <div
            onClick={() => setActiveView('overview')}
            className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-all ${
              activeView === 'overview' ? 'bg-blue-800/50 border-blue-400/30' : 'border-transparent hover:bg-blue-800/30'
            }`}
          >
            <Activity size={20} /> 
            <span className="font-semibold">Dashboard</span>
          </div>
          <div
            onClick={() => setActiveView('doctors')}
            className={`flex items-center justify-between gap-3 p-3 rounded-xl cursor-pointer border transition-all ${
              activeView === 'doctors' ? 'bg-blue-800/50 border-blue-400/30' : 'border-transparent hover:bg-blue-800/30'
            }`}
          >
            <span className="flex items-center gap-3">
              <BadgeCheck size={20} />
              <span className="font-semibold">Doctor Verification</span>
            </span>
            {stats.pending_doctor_verifications > 0 && (
              <span className="bg-amber-400 text-amber-950 text-[10px] font-black px-2 py-0.5 rounded-full">
                {stats.pending_doctor_verifications}
              </span>
            )}
          </div>
        </nav>
        
        <button 
          onClick={handleLogout} 
          className="flex items-center gap-3 p-3 hover:bg-red-600 rounded-xl cursor-pointer transition-all duration-300 mt-auto border border-transparent hover:border-red-400"
        >
          <LogOut size={20} /> 
          <span className="font-semibold">Logout</span>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-10 overflow-y-auto">
        <Toaster position="top-right" />

        {activeView === 'overview' && (
          <>
            <header className="mb-12">
              <h1 className="text-4xl font-black text-gray-900 tracking-tight">Welcome Back, Admin!</h1>
              <p className="text-gray-500 font-medium mt-2">Real-time system overview and analytics.</p>
            </header>

            {loading ? (
          /* Beautiful Skeleton Loading UI taake refresh par zero-zero khali screen na dikhe */
          <div className="space-y-12">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 flex items-center justify-between animate-pulse">
                  <div className="space-y-3">
                    <div className="h-3 w-24 bg-gray-200 rounded"></div>
                    <div className="h-8 w-16 bg-gray-300 rounded"></div>
                  </div>
                  <div className="p-4 bg-gray-100 rounded-2xl h-16 w-16"></div>
                </div>
              ))}
            </div>
            
            <div className="bg-white rounded-[2rem] shadow-sm p-8 border border-gray-100 space-y-6">
              <div className="h-5 w-48 bg-gray-200 rounded animate-pulse"></div>
              <div className="space-y-4">
                <div className="h-14 bg-gray-50 rounded-2xl animate-pulse"></div>
                <div className="h-14 bg-gray-50 rounded-2xl animate-pulse"></div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
              
              {/* User Card */}
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 flex items-center justify-between group hover:shadow-md transition-shadow">
                <div>
                  <p className="text-xs text-blue-600 font-black uppercase tracking-widest mb-2">Total Users</p>
                  <h3 className="text-5xl font-black text-gray-900">{stats.total_users}</h3>
                </div>
                <div className="p-4 bg-blue-50 rounded-2xl group-hover:scale-110 transition-transform">
                   <Users size={40} className="text-blue-600" />
                </div>
              </div>

              {/* Doctor Card */}
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 flex items-center justify-between group hover:shadow-md transition-shadow">
                <div>
                  <p className="text-xs text-purple-600 font-black uppercase tracking-widest mb-2">Total Doctors</p>
                  <h3 className="text-5xl font-black text-gray-900">{stats.total_doctors}</h3>
                </div>
                <div className="p-4 bg-purple-50 rounded-2xl group-hover:scale-110 transition-transform">
                   <Stethoscope size={40} className="text-purple-600" />
                </div>
              </div>

              {/* Scan Card */}
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 flex items-center justify-between group hover:shadow-md transition-shadow">
                <div>
                  <p className="text-xs text-green-600 font-black uppercase tracking-widest mb-2">AI Scans Done</p>
                  <h3 className="text-5xl font-black text-gray-900">{stats.total_scans}</h3>
                </div>
                <div className="p-4 bg-green-50 rounded-2xl group-hover:scale-110 transition-transform">
                   <Scan size={40} className="text-green-600" />
                </div>
              </div>

            </div>

            {/* System Info Section */}
            <div className="bg-white rounded-[2rem] shadow-sm p-8 border border-gray-100">
              <h3 className="text-xl font-black mb-6 text-gray-900 uppercase tracking-tight">System Status</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                    <span className="text-gray-600 font-bold">PostgreSQL Database</span>
                    <span className="px-4 py-1 bg-green-100 text-green-700 rounded-full text-xs font-black">CONNECTED ✅</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                    <span className="text-gray-600 font-bold">AI Prediction Engine</span>
                    <span className="px-4 py-1 bg-green-100 text-green-700 rounded-full text-xs font-black">ONLINE 🚀</span>
                </div>
              </div>
            </div>
          </>
        )}
          </>
        )}

        {activeView === 'doctors' && (
          <>
            <header className="mb-8">
              <h1 className="text-4xl font-black text-gray-900 tracking-tight">Doctor Verification</h1>
              <p className="text-gray-500 font-medium mt-2">Review PMDC license details before approving new doctors.</p>
            </header>

            {/* Status Filter Tabs */}
            <div className="flex gap-2 mb-6">
              {['pending', 'approved', 'rejected', 'all'].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide border transition-all ${
                    statusFilter === s
                      ? 'bg-[#0c2b5e] text-white border-[#0c2b5e]'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            {doctorsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-32 bg-white rounded-[2rem] shadow-sm border border-gray-100 animate-pulse"></div>
                ))}
              </div>
            ) : doctors.length === 0 ? (
              <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 p-12 text-center text-gray-400 font-semibold">
                No doctors found for this filter.
              </div>
            ) : (
              <div className="space-y-4">
                {doctors.map((doc) => (
                  <div key={doc.id} className="bg-white rounded-[2rem] shadow-sm border border-gray-100 p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="text-lg font-black text-gray-900">Dr. {doc.name}</h3>
                          <StatusPill status={doc.verification_status} />
                        </div>
                        <p className="text-xs text-gray-400 font-medium flex items-center gap-1">
                          <Mail size={12} /> {doc.email}
                          {!doc.is_email_verified && (
                            <span className="ml-2 text-amber-500 font-bold">(email not verified yet)</span>
                          )}
                        </p>
                      </div>
                      <span className="text-[11px] text-gray-400 font-semibold">Registered: {doc.created_at || 'N/A'}</span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
                      <div className="bg-gray-50 rounded-xl p-3">
                        <p className="text-gray-400 font-bold uppercase text-[10px] mb-1">License</p>
                        <p className="text-gray-800 font-black uppercase">{doc.license || 'Not provided'}</p>
                      </div>
                      <div className="bg-gray-50 rounded-xl p-3">
                        <p className="text-gray-400 font-bold uppercase text-[10px] mb-1 flex items-center gap-1"><Stethoscope size={10}/> Specialty</p>
                        <p className="text-gray-800 font-bold">{doc.specialty || 'N/A'}</p>
                      </div>
                      <div className="bg-gray-50 rounded-xl p-3">
                        <p className="text-gray-400 font-bold uppercase text-[10px] mb-1 flex items-center gap-1"><Building size={10}/> Hospital</p>
                        <p className="text-gray-800 font-bold truncate">{doc.hospital || 'N/A'}</p>
                      </div>
                      <div className="bg-gray-50 rounded-xl p-3">
                        <p className="text-gray-400 font-bold uppercase text-[10px] mb-1 flex items-center gap-1"><MapPin size={10}/> City</p>
                        <p className="text-gray-800 font-bold">{doc.city || 'N/A'}</p>
                      </div>
                    </div>

                    {doc.phone && (
                      <p className="text-xs text-gray-500 font-medium mb-3 flex items-center gap-1">
                        <Phone size={12} /> {doc.phone}
                      </p>
                    )}

                    {doc.verification_status === 'rejected' && doc.verification_note && (
                      <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 mb-4">
                        <p className="text-[11px] text-rose-600 font-semibold">Rejection note: {doc.verification_note}</p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                      {doc.verification_status !== 'approved' && (
                        <button
                          onClick={() => handleApprove(doc)}
                          disabled={actionLoadingId === doc.id}
                          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white text-xs font-black rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-all"
                        >
                          {actionLoadingId === doc.id ? <Loader size={14} className="animate-spin" /> : <BadgeCheck size={14} />}
                          Approve
                        </button>
                      )}
                      {doc.verification_status !== 'rejected' && (
                        <button
                          onClick={() => { setRejectModalDoctor(doc); setRejectNote(''); }}
                          disabled={actionLoadingId === doc.id}
                          className="flex items-center gap-1.5 px-4 py-2 bg-white text-rose-600 border border-rose-200 text-xs font-black rounded-xl hover:bg-rose-50 disabled:opacity-50 transition-all"
                        >
                          <ShieldAlert size={14} /> Reject
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteConfirmDoctor(doc)}
                        disabled={actionLoadingId === doc.id}
                        className="flex items-center gap-1.5 px-4 py-2 bg-white text-gray-500 border border-gray-200 text-xs font-black rounded-xl hover:bg-gray-100 disabled:opacity-50 transition-all ml-auto"
                      >
                        <Trash2 size={14} /> Delete Account
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Reject Reason Modal */}
        {rejectModalDoctor && (
          <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]">
            <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-black text-gray-800">Reject Dr. {rejectModalDoctor.name}?</h3>
                <button onClick={() => setRejectModalDoctor(null)} className="p-1 rounded-full hover:bg-gray-100 text-gray-400 border-none bg-transparent cursor-pointer">
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-gray-500 font-medium mb-3">Give a short reason (this may be emailed to the doctor). Optional but recommended.</p>
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="e.g. License number could not be verified against PMDC records"
                rows={3}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-rose-400 font-medium mb-4"
              />
              <div className="flex gap-2">
                <button onClick={() => setRejectModalDoctor(null)} className="flex-1 py-2.5 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 text-xs border-none cursor-pointer">
                  Cancel
                </button>
                <button
                  onClick={confirmReject}
                  disabled={actionLoadingId === rejectModalDoctor.id}
                  className="flex-1 py-2.5 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 text-xs flex items-center justify-center gap-2 border-none cursor-pointer disabled:opacity-50"
                >
                  {actionLoadingId === rejectModalDoctor.id ? <Loader size={14} className="animate-spin" /> : 'Confirm Reject'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirmDoctor && (
          <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]">
            <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-sm font-black text-gray-800 mb-2">Permanently delete Dr. {deleteConfirmDoctor.name}'s account?</h3>
              <p className="text-xs text-gray-500 font-medium mb-4">
                This cannot be undone. Their scans, appointments, and ratings linked to this account will also be affected. Only do this for confirmed fake or invalid accounts.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteConfirmDoctor(null)} className="flex-1 py-2.5 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 text-xs border-none cursor-pointer">
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={actionLoadingId === deleteConfirmDoctor.id}
                  className="flex-1 py-2.5 bg-gray-900 text-white font-bold rounded-xl hover:bg-black text-xs flex items-center justify-center gap-2 border-none cursor-pointer disabled:opacity-50"
                >
                  {actionLoadingId === deleteConfirmDoctor.id ? <Loader size={14} className="animate-spin" /> : 'Yes, Delete Permanently'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;