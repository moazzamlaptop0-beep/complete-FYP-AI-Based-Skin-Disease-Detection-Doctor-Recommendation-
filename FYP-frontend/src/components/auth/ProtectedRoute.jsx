import React from 'react';
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children, allowedRole }) => {
  // Local storage se user ka data nikal rahe hain
  const userString = localStorage.getItem('user');
  const user = userString ? JSON.parse(userString) : null;

  // Condition 1: Agar user login nahi hai, toh seedha Login page par bhej do
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Condition 2: Agar user login hai lekin uska role is page ke liye allowed nahi hai
  if (allowedRole && user.role !== allowedRole) {
    
    // User ko uske apne sahi dashboard/page par wapis bhej do
    if (user.role === 'Admin') {
      return <Navigate to="/admin-dashboard" replace />;
    } 
    else if (user.role === 'Doctor') {
      return <Navigate to="/doctor-dashboard" replace />;
    } 
    else {
      // Agar AI User hai toh home page par bhej do
      return <Navigate to="/" replace />; 
    }
  }

  // Condition 3: Agar user login bhi hai aur role bhi sahi hai, toh page dikha do
  return children;
};

export default ProtectedRoute;