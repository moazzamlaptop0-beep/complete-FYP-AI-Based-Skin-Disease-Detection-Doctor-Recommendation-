import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import imageCompression from 'browser-image-compression';
import { 
  UploadCloud, CheckCircle, Shield, Activity, 
  Info, X, Sparkles, ArrowLeft, Cpu, MapPin, 
  ChevronRight, AlertCircle, Camera, Lock, Crop
} from 'lucide-react';

const MAX_FILE_SIZE = 15 * 1024 * 1024; 

const LOADING_MESSAGES = [
  "Extracting pixels... ⏳",
  "Running neural patterns... 🧠",
  "Analyzing visual data... 🔍",
  "Finalizing report... ✅"
];

// --- HELPER UTILITIES FOR BASE64 PERSISTENCE ---
const blobToBase64 = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const base64ToFile = (base64String, filename, mimeType) => {
  const arr = base64String.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mimeType || mime });
};

const TryNowPage = () => {
  const [image, setImage] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null); 
  const [isDragging, setIsDragging] = useState(false);
  
  const [crop, setCrop] = useState({ unit: '%', width: 50, height: 50, x: 25, y: 25 });
  const [isCropping, setIsCropping] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const imgRef = useRef(null);

  const [loading, setLoading] = useState(false); 
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [result, setResult] = useState(null); 
  const [error, setError] = useState(null); 
  
  const [consentGiven, setConsentGiven] = useState(false);
  const [popup, setPopup] = useState({ show: false, type: 'info', message: '', action: null });
  
  // Camera Live Stream States
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef(null);

  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const loggedInUser = JSON.parse(localStorage.getItem('user'));

  // --- RESTORE STATE ON COMPONENT MOUNT ---
  useEffect(() => {
    const cachedImageBase64 = sessionStorage.getItem('cached_image_base64');
    const cachedImageName = sessionStorage.getItem('cached_image_name') || 'cropped_disease_image.jpg';
    const cachedImageType = sessionStorage.getItem('cached_image_type') || 'image/jpeg';
    const savedResult = sessionStorage.getItem('lastScanResult');

    if (cachedImageBase64) {
      try {
        const file = base64ToFile(cachedImageBase64, cachedImageName, cachedImageType);
        const objectUrl = URL.createObjectURL(file);
        setImage(objectUrl);
        setSelectedFile(file);
      } catch (err) {
        console.error("Failed to restore cached image:", err);
      }
    }

    if (savedResult) {
      const parsed = JSON.parse(savedResult);
      const ageMinutes = (Date.now() - parsed.timestamp) / 60000;
      if (ageMinutes < 30) {
        setResult(parsed);
      } else {
        sessionStorage.removeItem('lastScanResult');
      }
    }
  }, []);

  // Handle Phased Loading Animation
  useEffect(() => {
    let interval;
    if (loading) {
      setLoadingPhase(0);
      interval = setInterval(() => {
        setLoadingPhase((prev) => (prev < LOADING_MESSAGES.length - 1 ? prev + 1 : prev));
      }, 1500); 
    }
    return () => clearInterval(interval);
  }, [loading]);

  // Cleanup camera stream when component unmounts
  useEffect(() => {
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // --- LIVE CAMERA HANDLERS (LAPTOP & MOBILE FRIENDLY) ---
  const startCamera = async () => {
    try {
      setIsCameraActive(true);
      setImage(null);
      setSelectedFile(null);
      setResult(null);
      setError(null);
      setIsCropping(false);

      // Check if browser/protocol supports camera
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("SECURE_CONTEXT_REQUIRED");
      }

      // Safe constraints for both Laptop Webcam and Mobile back-camera
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user" // Default user facing (best for laptop webcams)
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      setIsCameraActive(false);

      let errorMessage = 'Could not access camera. Please ensure camera permissions are allowed.';
      
      if (err.message === "SECURE_CONTEXT_REQUIRED" || window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        errorMessage = 'Camera API requires a secure connection (HTTPS) or Localhost to run on laptops. Please check your browser URL.';
      }

      setPopup({ 
        show: true, 
        type: 'error', 
        message: errorMessage
      });
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'captured_skin_image.jpg', { type: 'image/jpeg' });
        processFile(file);
        stopCamera();
      }
    }, 'image/jpeg', 0.95);
  };

  const processFile = (file) => {
    if (!file.type.startsWith('image/')) {
      setPopup({ show: true, type: 'error', message: 'Please upload a valid image file.' });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setPopup({ show: true, type: 'error', message: 'Image size should be less than 15MB.' });
      return;
    }
    
    const objectUrl = URL.createObjectURL(file);
    setImage(objectUrl);
    setSelectedFile(file);
    setIsCropping(true);
    setResult(null); 
    setError(null);
    sessionStorage.removeItem('lastScanResult');
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => { setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  // --- CROPPER & COMPRESSION UTILITY ---
  const getCroppedImg = async () => {
    if (!imgRef.current) return;
    
    setIsCompressing(true);
    const imageElement = imgRef.current;
    const canvas = document.createElement('canvas');
    const scaleX = imageElement.naturalWidth / imageElement.width;
    const scaleY = imageElement.naturalHeight / imageElement.height;
    
    canvas.width = crop.width * scaleX;
    canvas.height = crop.height * scaleY;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(
      imageElement,
      crop.x * scaleX,
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0, 0,
      canvas.width, canvas.height
    );

    canvas.toBlob(async (blob) => {
      if (!blob) {
        setIsCompressing(false);
        return;
      }
      
      try {
        const compressionOptions = {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 800,
          useWebWorker: true,
        };

        const compressedBlob = await imageCompression(blob, compressionOptions);
        
        const base64Data = await blobToBase64(compressedBlob);
        sessionStorage.setItem('cached_image_base64', base64Data);
        sessionStorage.setItem('cached_image_name', 'cropped_disease_image.jpg');
        sessionStorage.setItem('cached_image_type', 'image/jpeg');

        const finalFile = new File([compressedBlob], 'cropped_disease_image.jpg', { type: 'image/jpeg' });
        const finalUrl = URL.createObjectURL(compressedBlob);
        
        setImage(finalUrl);
        setSelectedFile(finalFile); 
        setIsCropping(false);
        
        console.log(`Ready for API: ${(finalFile.size / 1024).toFixed(2)} KB`);
      } catch (err) {
        console.error("Compression error:", err);
        const fallbackFile = new File([blob], 'cropped_image.jpg', { type: 'image/jpeg' });
        const fallbackUrl = URL.createObjectURL(blob);
        setImage(fallbackUrl);
        setSelectedFile(fallbackFile);
        setIsCropping(false);
      } finally {
        setIsCompressing(false);
      }
    }, 'image/jpeg', 0.95);
  };

  const clearImage = () => {
    setImage(null);
    setSelectedFile(null);
    setResult(null);
    setError(null);
    setIsCropping(false);
    setConsentGiven(false);
    setIsCameraActive(false);
    
    sessionStorage.removeItem('cached_image_base64');
    sessionStorage.removeItem('cached_image_name');
    sessionStorage.removeItem('cached_image_type');
    sessionStorage.removeItem('lastScanResult');

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const closePopup = () => {
    setPopup({ ...popup, show: false });
    if (popup.action === 'redirect_login') {
      navigate('/login');
    }
  };

  const handleAnalyze = async () => {
    if (!loggedInUser) {
      setPopup({ show: true, type: 'error', message: 'Please login to your account to perform an AI scan.', action: 'redirect_login' });
      return;
    }

    if (!selectedFile || !consentGiven) return;

    setLoading(true);
    setError(null);

    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append("image", selectedFile);
    formData.append("user_id", loggedInUser.id);

  	try {
  		const response = await fetch(`${import.meta.env.VITE_API_URL}/predict`, {
  			method: "POST",
  			headers: {
  				'Authorization': `Bearer ${token}`,
  				'x-access-token': token
  			},
  			body: formData,
  		});

  		if (!response.ok) {
  			if (response.status === 401) {
  				localStorage.removeItem('user');
  				localStorage.removeItem('token');
  				setPopup({ show: true, type: 'error', message: 'Your session has expired. Please login again to continue.', action: 'redirect_login' });
  				return;
  			}
  			throw new Error("Server error");
  		}

  		const json = await response.json();
      if (!json.success) throw new Error(json.error || "Prediction failed");
      setResult(json.data);
  		
  		sessionStorage.setItem('lastScanResult', JSON.stringify({ ...json.data, timestamp: Date.now() }));
  		
  	} catch (err) {
  		console.error("Connection Error:", err);
  		setPopup({ show: true, type: 'error', message: 'Backend connection failed. Is the AI server running or Token missing?' });
  	} finally {
  		setLoading(false);
  	}
  };

  const findNearbyDoctors = () => {
    if (!result || !result.scan_id) {
      setPopup({ show: true, type: 'error', message: 'Scan ID missing. Please try scanning again.' });
      return;
    }
    navigate('/nearby-doctors', { state: { disease: result.disease, scan_id: result.scan_id } });
  };

  return (
    <div className="w-full min-h-screen bg-white text-gray-900 flex flex-col items-center overflow-x-hidden relative pb-20 font-sans">
      
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#2563eb 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>

      <header className="w-full px-6 py-4 flex items-center justify-between z-20 backdrop-blur-md bg-white/70 sticky top-0 border-b border-gray-100">
        <button onClick={() => navigate('/')} className="group flex items-center gap-2 px-5 py-2.5 rounded-full bg-white shadow-sm hover:shadow-md text-blue-600 font-bold transition-all border border-gray-200">
          <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
          <span>Exit Scan</span>
        </button>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100">
          <Activity className="text-blue-600 animate-pulse" size={22} />
          <span className="font-bold tracking-tight text-blue-900 hidden sm:inline uppercase text-sm">Derma AI Scanner</span>
        </div>
      </header>

      <div className="max-w-5xl w-full flex flex-col items-center z-10 py-12 px-6">
        <div className="text-center mb-12 animate-fadeIn">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 text-blue-600 text-xs font-bold uppercase tracking-widest mb-4 border border-blue-100">
            <Sparkles size={14} /> AI-Powered Skin Analysis
          </div>
          <h1 className="text-4xl md:text-6xl font-black mb-4 text-[#0c2b5e] tracking-tight">
            {result ? "Analysis Results" : "Start Your Analysis"}
          </h1>
          <p className="text-gray-500 text-lg max-w-xl mx-auto font-medium">
            {result ? "Our neural network has processed your image. See the details below." : "Upload or capture an image of the affected area for a deep neural scan."}
          </p>
        </div>

        <div className="w-full flex flex-col lg:flex-row gap-10 items-start justify-center">
          {/* LEFT: Image Upload/Preview/Crop/Camera */}
          <div className="w-full lg:w-1/2">
            <div 
              className={`relative group w-full min-h-[400px] rounded-[3rem] border-2 border-dashed transition-all duration-500 flex flex-col items-center justify-center p-8 text-center
                ${isDragging ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-gray-200 bg-gray-50/50 hover:border-blue-300'}
                ${result ? (result.confidence > 70 ? 'border-green-400 bg-green-50/30' : 'border-yellow-400 bg-yellow-50/30') : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              
              <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />

              {isCameraActive ? (
                <div className="w-full flex flex-col items-center animate-zoomIn">
                  <h3 className="text-sm font-bold text-gray-500 mb-4 flex items-center gap-2">
                    <Camera size={16} /> Center the skin concern in the window
                  </h3>
                  <div className="relative w-full max-h-[300px] aspect-square overflow-hidden rounded-3xl bg-black border-4 border-white shadow-2xl flex items-center justify-center">
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      playsInline 
                      className="w-full h-full object-cover max-h-[300px]"
                    />
                  </div>
                  <div className="flex gap-3 mt-6 w-full">
                    <button onClick={stopCamera} className="flex-1 px-4 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-all">
                      Cancel
                    </button>
                    <button onClick={capturePhoto} className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md hover:bg-blue-700 transition-all flex justify-center items-center gap-2">
                      <Camera size={18} /> Capture Photo
                    </button>
                  </div>
                </div>
              ) : !image ? (
                <>
                  <div className="mb-8 relative">
                    <div className="w-20 h-20 bg-white rounded-3xl shadow-xl flex items-center justify-center relative z-10 border border-gray-100 group-hover:scale-110 transition-transform duration-500">
                        <UploadCloud className="text-blue-500" size={40} />
                    </div>
                    <div className="absolute -inset-4 bg-blue-400/10 blur-2xl rounded-full animate-pulse"></div>
                  </div>
                  <h3 className="text-xl font-bold text-gray-800 mb-2">Select or Capture</h3>
                  
                  <div className="flex flex-col sm:flex-row gap-3 mt-6 w-full max-w-sm">
                    <button onClick={() => fileInputRef.current.click()} className="moving-ai-btn flex-1">
                        <div className="btn-content justify-center">
                            <Cpu size={20} className="icon-move" />
                            <span>GALLERY</span>
                        </div>
                    </button>
                    <button onClick={startCamera} className="bg-[#0c2b5e] text-white px-6 py-4 rounded-[100px] font-bold shadow-lg hover:bg-[#163a75] hover:scale-105 transition-all flex items-center justify-center gap-2 flex-1">
                        <Camera size={20} />
                        <span>CAMERA</span>
                    </button>
                  </div>
                  <p className="mt-6 text-xs text-gray-400 font-medium">Max file size: 15MB</p>
                </>
              ) : isCropping ? (
                <div className="w-full flex flex-col items-center animate-zoomIn">
                  <h3 className="text-sm font-bold text-gray-500 mb-4 flex items-center gap-2">
                    <Crop size={16} /> Crop affected area for better results
                  </h3>
                  <div className="max-h-[300px] overflow-hidden rounded-xl border border-gray-200">
                    <ReactCrop crop={crop} onChange={c => setCrop(c)} aspect={1}>
                      <img ref={imgRef} src={image} alt="Crop preview" className="max-h-[300px] w-auto" />
                    </ReactCrop>
                  </div>
                  <div className="flex gap-3 mt-6 w-full">
                    <button onClick={clearImage} disabled={isCompressing} className="flex-1 px-4 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-all disabled:opacity-50">Cancel</button>
                    <button onClick={getCroppedImg} disabled={isCompressing} className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md hover:bg-blue-700 transition-all flex justify-center items-center gap-2 disabled:opacity-70">
                      {isCompressing ? <Activity size={18} className="animate-spin" /> : 'Crop & Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center animate-zoomIn">
                    <div className="relative overflow-hidden rounded-3xl shadow-2xl border-4 border-white mb-6 bg-gray-900 flex justify-center w-full max-h-[300px]">
                      <img src={image} alt="Preview" className="max-h-[300px] object-contain w-full rounded-2xl opacity-90" />
                      
                      {loading && (
                        <div className="absolute inset-0 pointer-events-none z-10">
                           <div className="absolute top-0 left-0 w-full h-[20%] bg-gradient-to-b from-transparent to-blue-500/40 border-b-2 border-blue-400 animate-scan shadow-[0_5px_15px_rgba(59,130,246,0.5)]"></div>
                        </div>
                      )}
                    </div>

                    {!loading && !result && (
                      <button onClick={clearImage} className="px-6 py-2 bg-white text-red-500 rounded-full font-bold shadow-md hover:bg-red-50 border border-red-100 flex items-center gap-2 transition-all">
                        <X size={18} /> Remove Image
                      </button>
                    )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Results & Actions */}
          <div className="w-full lg:w-1/2">
            {!image && !isCameraActive && (
                <div className="p-8 bg-blue-50 rounded-[2.5rem] border border-blue-100">
                    <h4 className="font-black text-[#0c2b5e] mb-4 flex items-center gap-2"><Info size={20}/> Quick Tips</h4>
                    <ul className="space-y-4">
                        {[
                            "Use natural daylight if possible",
                            "Ensure the image is in sharp focus",
                            "Crop to center the skin concern",
                            "Avoid using camera flash directly"
                        ].map((tip, i) => (
                            <li key={i} className="flex items-start gap-3 text-sm text-blue-800 font-medium">
                                <CheckCircle size={16} className="mt-0.5 text-blue-500 flex-shrink-0" /> {tip}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {image && !isCropping && !result && (
                <div className="flex flex-col items-center justify-center h-full pt-6">
                    
                    {/* CONSENT CHECKBOX */}
                    <div className="w-full bg-blue-50/50 p-4 rounded-2xl border border-blue-100 mb-6 animate-fadeIn">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <div className="mt-1">
                          <input 
                            type="checkbox" 
                            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            checked={consentGiven}
                            onChange={(e) => setConsentGiven(e.target.checked)}
                            disabled={loading}
                          />
                        </div>
                        <span className="text-sm text-gray-700 font-medium leading-relaxed">
                          I agree that this is an AI tool and not a medical diagnosis. I understand I should consult a certified dermatologist for professional medical advice.
                        </span>
                      </label>
                    </div>

                    <button 
                      onClick={handleAnalyze} 
                      disabled={loading || !consentGiven}
                      className={`w-full py-5 font-black rounded-[2rem] shadow-xl transition-all flex items-center justify-center gap-3 active:scale-95
                        ${(loading || !consentGiven) ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#0c2b5e] text-white hover:bg-[#163a75]'}`}
                    >
                      {loading ? <Activity className="animate-spin" /> : <Sparkles />}
                      {loading ? LOADING_MESSAGES[loadingPhase] : loggedInUser ? 'START AI DIAGNOSIS' : 'LOGIN TO SCAN'}
                    </button>
                    
                    {/* PRIVACY BADGE */}
                    <div className="mt-4 flex items-center gap-2 text-xs font-bold text-green-600 bg-green-50 px-4 py-2 rounded-full border border-green-100 animate-fadeIn">
                      <Lock size={14} /> 100% Secure & Private. Images are end-to-end encrypted.
                    </div>

                    {!loggedInUser && <p className="mt-4 text-sm text-gray-400 font-medium italic">Scanning requires a registered patient account.</p>}
                </div>
            )}

            {result && (
                <div className="space-y-6 animate-fadeIn">
                    <div className={`bg-white p-8 rounded-[2.5rem] shadow-2xl border-2 relative overflow-hidden transition-all duration-700 ${result.confidence > 70 ? 'border-green-400' : 'border-yellow-400'}`}>
                        <div className={`absolute top-0 right-0 p-4 text-white font-black text-[10px] rounded-bl-2xl transition-colors ${result.confidence > 70 ? 'bg-green-400' : 'bg-yellow-400'}`}>
                          {result.confidence > 70 ? 'HIGH ACCURACY SCAN' : 'RE-SCAN RECOMMENDED'}
                        </div>
                        
                        <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-2">Detected Condition</h2>
                        <h1 className="text-3xl font-black text-[#0c2b5e] mb-6">{result.disease}</h1>
                        
                        <div className="mb-2 flex justify-between font-bold text-sm">
                            <span className="text-gray-500">Confidence Score</span>
                            <span className={result.confidence > 70 ? 'text-green-600' : 'text-yellow-600'}>{result.confidence}%</span>
                        </div>
                        
                        <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden mb-8">
                            <div 
                                className={`h-full transition-all duration-1000 ${result.confidence > 70 ? 'bg-green-500' : 'bg-yellow-500'}`} 
                                style={{ width: `${result.confidence}%` }}
                            ></div>
                        </div>
                        
                        <button onClick={clearImage} className="text-sm font-bold text-gray-400 hover:text-blue-600 flex items-center gap-1 transition-all">
                            <X size={14}/> Scan different area
                        </button>
                    </div>

                    <div className="bg-gradient-to-br from-[#0c2b5e] to-[#163a75] p-8 rounded-[2.5rem] shadow-2xl text-white relative overflow-hidden group">
                        <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-3xl group-hover:bg-blue-400/10 transition-colors"></div>
                        
                        <div className="relative z-10">
                          <div className="flex items-start gap-4 mb-6">
                              <div className="p-3 bg-white/10 rounded-2xl border border-white/10">
                                  <Shield className="text-[#3fd5c2]" size={30} />
                              </div>
                              <div>
                                  <h3 className="text-xl font-black italic">Consult a Specialist</h3>
                                  <p className="text-blue-200 text-sm mt-1 leading-relaxed">
                                      {result.confidence < 60 
                                        ? "AI results are below confidence threshold. A clinical skin checkup is highly recommended." 
                                        : "While our AI is advanced, a physical biopsy by a dermatologist is the gold standard for safety."}
                                  </p>
                              </div>
                          </div>
                          
                          <button 
                            onClick={findNearbyDoctors} 
                            className="w-full py-4 bg-[#3fd5c2] text-[#0c2b5e] font-black rounded-2xl hover:bg-white hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg group"
                          >
                              <MapPin size={20} className="group-hover:animate-bounce" />
                              FIND NEARBY DERMATOLOGISTS
                              <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
                          </button>
                        </div>
                    </div>
                </div>
            )}
          </div>
        </div>
      </div>

      {popup.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl transform transition-all animate-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center">
              
              {popup.type === 'error' ? (
                <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
                  <AlertCircle size={32} />
                </div>
              ) : (
                <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mb-4">
                  <Activity className="w-8 h-8" />
                </div>
              )}

              <h3 className={`text-2xl font-black mb-2 ${popup.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
                {popup.type === 'error' ? 'Oops! Error' : 'Success'}
              </h3>
              
              <p className="text-slate-500 font-medium leading-relaxed mb-8">
                {popup.message}
              </p>

              <button
                onClick={closePopup}
                className={`w-full font-bold py-3 px-6 rounded-xl transition-colors ${
                  popup.type === 'error' 
                    ? 'bg-red-50 hover:bg-red-100 text-red-600' 
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {popup.action === 'redirect_login' ? 'Go to Login' : 'Okay, Got it'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes zoomIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        @keyframes float { 
            0%, 100% { transform: translateY(0px); } 
            50% { transform: translateY(-10px); } 
        }
        @keyframes scan {
            0% { top: -30%; opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { top: 100%; opacity: 0; }
        }
        .animate-fadeIn { animation: fadeIn 0.6s cubic-bezier(0.23, 1, 0.32, 1) forwards; }
        .animate-zoomIn { animation: zoomIn 0.5s cubic-bezier(0.23, 1, 0.32, 1) forwards; }
        .animate-scan { animation: scan 2s linear infinite; }
        
        .moving-ai-btn {
            position: relative;
            background: #fff;
            padding: 1rem 2.5rem;
            border-radius: 100px;
            font-weight: 800;
            color: #2563eb;
            border: 2px solid #2563eb;
            transition: 0.4s;
            animation: float 3s infinite ease-in-out;
        }
        .moving-ai-btn:hover {
            background: #2563eb;
            color: #fff;
            transform: scale(1.05);
            box-shadow: 0 15px 30px rgba(37, 99, 235, 0.2);
        }
        .btn-content { display: flex; align-items: center; gap: 10px; }
      `}} />
    </div>
  );
};

export default TryNowPage;