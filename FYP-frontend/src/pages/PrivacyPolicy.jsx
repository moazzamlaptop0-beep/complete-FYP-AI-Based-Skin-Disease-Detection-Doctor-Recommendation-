import React from 'react';

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-gray-50 py-16 px-6 font-sans">
      <div className="max-w-4xl mx-auto bg-white p-8 md:p-12 shadow-sm border border-gray-100 rounded-lg">
        
        {/* Page Heading */}
        <h1 className="text-3xl font-bold text-[#113463] mb-8 border-b pb-4">
          Privacy Policy
        </h1>
        
        {/* Policy Content */}
        <div className="text-gray-600 space-y-6 leading-relaxed">
          <p className="text-sm text-gray-500 mb-6">
            <strong>Last Updated:</strong> June 2026
          </p>
          
          <p>
            Welcome to AI Dermatologist. Your privacy is critically important to us. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website or use our application.
          </p>
          
          {/* Section 1 */}
          <div>
            <h2 className="text-xl font-semibold text-[#113463] mt-6 mb-3">
              1. Information We Collect
            </h2>
            <p>
              We may collect personal identification information such as your name, email address, and demographic data. When you use our skin scanning feature, we securely collect and process the images you upload solely for the purpose of analysis and tracking.
            </p>
          </div>
          
          {/* Section 2 */}
          <div>
            <h2 className="text-xl font-semibold text-[#113463] mt-6 mb-3">
              2. How We Use Your Information
            </h2>
            <ul className="list-disc list-inside mt-2 space-y-2">
              <li>To provide, operate, and maintain our AI scanning services.</li>
              <li>To improve, personalize, and expand our website's functionality.</li>
              <li>To communicate with you regarding updates, support, or security alerts.</li>
              <li>To monitor and analyze usage and trends to improve your experience.</li>
            </ul>
          </div>

          {/* Section 3 */}
          <div>
            <h2 className="text-xl font-semibold text-[#113463] mt-6 mb-3">
              3. Data Security
            </h2>
            <p>
              We implement a variety of security measures to maintain the safety of your personal information. Your uploaded images are encrypted and stored on secure servers. However, please be aware that no method of transmission over the internet is 100% secure.
            </p>
          </div>

          {/* Section 4 */}
          <div>
            <h2 className="text-xl font-semibold text-[#113463] mt-6 mb-3">
              4. Sharing of Information
            </h2>
            <p>
              We do not sell, trade, or rent your personal identification information to others. We may share generic aggregated demographic information not linked to any personal identification information with our business partners and trusted affiliates.
            </p>
          </div>

          {/* Section 5 */}
          <div>
            <h2 className="text-xl font-semibold text-[#113463] mt-6 mb-3">
              5. Contact Us
            </h2>
            <p>
              If you have any questions or concerns about this Privacy Policy, please contact us at:
            </p>
            <p className="mt-2 font-medium">
              Email: <a href="mailto:support@ai-derm.com" className="text-[#113463] hover:underline">support@ai-derm.com</a>
            </p>
          </div>

        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;