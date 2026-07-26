import React, { useState, useRef, useEffect } from "react";

import api, { ApiError } from "../../lib/api";
import endpoints from "../../lib/endpoints";
import {
  Brain,
  X,
  Send,
  Sparkles,
  User,
  Activity,
  ShieldCheck, // Admin icon
  Stethoscope, // Doctor icon
} from "lucide-react";

const FloatingChatbot = () => {
  // Synchronously role fetch karein taake pehla message role ke hisab se aaye
  const [userRole, setUserRole] = useState(() => {
    try {
      const savedUser = localStorage.getItem("user") || sessionStorage.getItem("user");
      if (savedUser) {
        return JSON.parse(savedUser).role;
      }
      return null;
    } catch (err) {
      console.error("Error parsing user context:", err);
      return null;
    }
  });

  const [isOpen, setIsOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [detectedDisease, setDetectedDisease] = useState(null);

  const messagesEndRef = useRef(null);
  
  // Refs to track scans and timers
  const lastScanRef = useRef(null); 
  const lastGreetedScanRef = useRef(null);
  const tooltipTimerRef = useRef(null);

  // Role checks
  const isPatientOrGuest = !userRole || userRole === "AI User" || userRole === "Patient";
  const isDoctor = userRole === "Doctor";
  const isAdmin = userRole === "Admin";

  // Dynamic Initial Greeting
  const getGreetingMessage = () => {
    if (isAdmin) return "Hello Admin! I am your System Assistant. Need help managing the platform or checking stats?";
    if (isDoctor) return "Hello Doctor! I am your Clinical AI Assistant. How can I help you with dermatological analysis or medical queries today?";
    return "Hello! I am your AI Derma Assistant. How can I help you with your skin concerns today?";
  };

  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: "bot",
      text: getGreetingMessage(),
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);

  // Auto Scroll
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  // 1. Real-time Scan Checker & Auto-Hide Tooltip (ONLY FOR PATIENTS/GUESTS)
  useEffect(() => {
    if (!isPatientOrGuest) return; 

    const checkScanResult = () => {
      const savedScan = sessionStorage.getItem("lastScanResult");
      
      if (savedScan && savedScan !== lastScanRef.current) {
        lastScanRef.current = savedScan; 

        try {
          const scanData = JSON.parse(savedScan);
          const disease = scanData.disease || scanData.condition;
          
          if (disease) {
            setDetectedDisease(disease);

            if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
            tooltipTimerRef.current = setTimeout(() => {
              setDetectedDisease(null);
            }, 8000); 
          }
        } catch (error) {
          console.error("Scan Error:", error);
        }
      }
    };

    const interval = setInterval(checkScanResult, 1500);
    return () => {
      clearInterval(interval);
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
  }, [isPatientOrGuest]);

  // 2. Chat Open hone par Naye Scan ka message bhejna (ONLY FOR PATIENTS/GUESTS)
  useEffect(() => {
    if (isOpen) {
      setDetectedDisease(null);
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);

      if (!isPatientOrGuest) return; 

      const savedScan = sessionStorage.getItem("lastScanResult");

      if (savedScan && savedScan !== lastGreetedScanRef.current) {
        lastGreetedScanRef.current = savedScan; 

        try {
          const scanData = JSON.parse(savedScan);
          const disease = scanData.disease || scanData.condition || "Nail Fungus / Skin Infection";

          if (disease) {
            const aiProactiveMessage = {
              id: Date.now(),
              sender: "bot",
              text: `I received your recent scan report showing **${disease}**. Would you like to know more about its causes, symptoms, or treatments?`,
              time: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            };

            setMessages((prev) => [...prev, aiProactiveMessage]);
          }
        } catch (error) {
          console.error("Scan Error:", error);
        }
      }
    }
  }, [isOpen, isPatientOrGuest]);

  // 🚀 SECURE BACKEND API CALL 
  const fetchGeminiResponse = async (userText) => {
    try {
      const savedScan = sessionStorage.getItem("lastScanResult");
      let messageToSend = userText;

      // Scan ka context sirf Patient/Guest ke liye append karein
      if (savedScan && isPatientOrGuest) {
        const scanData = JSON.parse(savedScan);
        const disease = scanData.disease || scanData.condition;
        messageToSend = `[Context: The user recently scanned for ${disease} with ${scanData.confidence}% confidence. Keep this in mind while answering]. User Question: ${userText}`;
      }

      // Goes through the shared client rather than a hand-rolled fetch: it
      // owns the base URL (this file used to read import.meta.env directly,
      // one of five different derivations in the old codebase), attaches the
      // bearer token, and unwraps the {success,data,error} envelope. The chat
      // route accepts anonymous callers, so no token is fine.
      const data = await api.post(endpoints.chat.send(), { message: messageToSend });
      return data?.reply || "No response received.";
    } catch (error) {
      // ApiError carries the server's message; anything else is a transport
      // failure, which for a chat widget means the backend is unreachable.
      if (error instanceof ApiError) {
        return `Error: ${error.message || "Something went wrong"}`;
      }
      console.error("Chat Server Error:", error);
      return "Server connection failed. Please ensure the backend is running.";
    }
  };

  // Send Message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    const userText = inputMessage;
    const userMsgObj = {
      id: Date.now(),
      sender: "user",
      text: userText,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMsgObj]);
    setInputMessage("");
    setIsTyping(true);

    const aiResponseText = await fetchGeminiResponse(userText);

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() + 1,
        sender: "bot",
        text: aiResponseText,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ]);
    setIsTyping(false);
  };

  // Dynamic Header Components based on Role
  const getHeaderInfo = () => {
    if (isAdmin) return { title: "System Admin Assistant", icon: <ShieldCheck size={20} className="text-white" />, color: "bg-purple-600" };
    if (isDoctor) return { title: "Clinical AI Assistant", icon: <Stethoscope size={20} className="text-white" />, color: "bg-teal-600" };
    return { title: "Derma AI Consultant", icon: <Brain size={20} className="text-white animate-pulse" />, color: "bg-blue-600" };
  };

  const headerInfo = getHeaderInfo();

  // 🛑 AGAR AAP ADMIN SE CHATBOT HIDE KARNA CHAHTE HAIN:
  // Neeche wali line se comment (//) hata dein:
  // if (isAdmin) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* CHAT WINDOW */}
      {isOpen && (
        <div className="mb-4 w-[350px] sm:w-[400px] h-[550px] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100">
          {/* DYNAMIC HEADER */}
          <div className={`p-4 text-white flex justify-between items-center ${
            isAdmin ? "bg-gradient-to-r from-gray-800 to-gray-600" : 
            isDoctor ? "bg-gradient-to-r from-teal-800 to-teal-600" : 
            "bg-gradient-to-r from-[#0c2b5e] to-[#163a75]"
          }`}>
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  {headerInfo.icon}
                </div>
                <div className={`absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 ${
                  isAdmin ? "border-gray-800" : isDoctor ? "border-teal-800" : "border-[#163a75]"
                }`}></div>
              </div>
              <div>
                <h3 className="font-bold text-sm">
                  {headerInfo.title}
                </h3>
                <p className="text-[10px] text-gray-200 flex items-center gap-1">
                  <Activity size={10} />
                  Online {userRole ? `(${userRole})` : ""}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* MESSAGES */}
          <div className="flex-1 p-4 overflow-y-auto bg-slate-50 flex flex-col gap-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex w-full ${
                  msg.sender === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {/* BOT ICON IN CHAT */}
                {msg.sender === "bot" && (
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-2 flex-shrink-0 mt-auto mb-1 ${
                    isAdmin ? "bg-gray-200 border-gray-300" : isDoctor ? "bg-teal-100 border-teal-200" : "bg-blue-100 border-blue-200"
                  }`}>
                    {isAdmin ? <ShieldCheck size={14} className="text-gray-600"/> : isDoctor ? <Stethoscope size={14} className="text-teal-600"/> : <Sparkles size={14} className="text-blue-600" />}
                  </div>
                )}

                {/* MESSAGE TEXT */}
                <div
                  className={`max-w-[75%] p-3 rounded-2xl shadow-sm text-sm ${
                    msg.sender === "user"
                      ? "bg-[#2563eb] text-white rounded-br-sm"
                      : "bg-white border border-gray-100 text-gray-700 rounded-bl-sm"
                  }`}
                >
                  <div
                    className="leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: msg.text
                        .replace(/\n/g, "<br/>")
                        .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>"),
                    }}
                  />
                  <span
                    className={`text-[10px] block mt-1 ${
                      msg.sender === "user"
                        ? "text-blue-200 text-right"
                        : "text-gray-400 text-left"
                    }`}
                  >
                    {msg.time}
                  </span>
                </div>

                {/* USER ICON */}
                {msg.sender === "user" && (
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center ml-2 flex-shrink-0 mt-auto mb-1">
                    <User
                      size={14}
                      className="text-slate-500"
                    />
                  </div>
                )}
              </div>
            ))}

            {/* TYPING INDICATOR */}
            {isTyping && (
              <div className="flex w-full justify-start items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                   isAdmin ? "bg-gray-200" : isDoctor ? "bg-teal-100" : "bg-blue-100"
                }`}>
                   {headerInfo.icon}
                </div>
                <div className="bg-white p-3 rounded-2xl rounded-bl-sm border border-gray-100 flex gap-1 items-center">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.4s" }}></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* INPUT */}
          <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-gray-100">
            <div className="relative flex items-center">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                disabled={isTyping}
                placeholder={isTyping ? "AI is typing..." : isAdmin ? "Ask system queries..." : isDoctor ? "Ask clinical queries..." : "Ask about your skin..."}
                className="w-full bg-slate-100 text-sm text-gray-700 rounded-full pl-4 pr-12 py-3 outline-none focus:ring-2 focus:ring-blue-500/50 border border-transparent focus:border-blue-300"
              />
              <button
                type="submit"
                disabled={!inputMessage.trim() || isTyping}
                className={`absolute right-1 w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  inputMessage.trim() && !isTyping
                    ? "bg-[#2563eb] text-white hover:bg-blue-700"
                    : "bg-transparent text-gray-400"
                }`}
              >
                <Send size={16} />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* FLOATING BUTTON WITH DYNAMIC TOOLTIP */}
      <div className="relative flex items-center">
        {/* Tooltip sirf patients/guests ko naye scan pe dikhega */}
        {!isOpen && isPatientOrGuest && detectedDisease && (
          <div
            onClick={() => setIsOpen(true)}
            className="absolute right-full mr-4 w-max bg-white text-[#0c2b5e] text-sm font-semibold py-2.5 px-4 rounded-2xl shadow-xl border border-blue-100 cursor-pointer animate-bounce flex items-center gap-2"
          >
            <Sparkles size={16} className="text-red-500" />
            <span><b className="text-red-600">{detectedDisease}</b> detected! Can I help you?</span>
            <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 bg-white border-r border-t border-blue-100 rotate-45"></div>
          </div>
        )}
        
        {/* Default Tooltip (Guest/Patient) */}
        {!isOpen && isPatientOrGuest && !detectedDisease && (
           <div onClick={() => setIsOpen(true)} className="absolute right-full mr-4 w-max bg-white text-[#0c2b5e] text-sm font-semibold py-2.5 px-4 rounded-2xl shadow-xl border border-blue-100 cursor-pointer animate-bounce flex items-center gap-2">
             <Sparkles size={16} className="text-blue-500" />
             "Hi! I'm your AI Assistant"
             <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 bg-white border-r border-t border-blue-100 rotate-45"></div>
           </div>
        )}

        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`relative group w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
            isOpen
              ? "bg-red-500 rotate-90 scale-90"
              : isAdmin ? "bg-gradient-to-r from-gray-800 to-gray-600 hover:scale-110" 
              : isDoctor ? "bg-gradient-to-r from-teal-800 to-teal-600 hover:scale-110"
              : "bg-gradient-to-r from-[#0c2b5e] to-[#2563eb] hover:scale-110"
          }`}
        >
          {isOpen ? (
            <X size={28} className="text-white" />
          ) : (
            <>
              {/* Using standard icon for floating button */}
              {headerInfo.icon}
              <div className="absolute inset-0 rounded-full border-2 border-white/20 scale-110 group-hover:animate-ping opacity-50"></div>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default FloatingChatbot;