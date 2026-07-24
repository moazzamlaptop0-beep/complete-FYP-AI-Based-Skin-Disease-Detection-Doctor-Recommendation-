import React from 'react';

const TermsOfUse = () => {
  return (
    <div className="min-h-screen bg-gray-50 py-16 px-6 font-sans">
      <div className="max-w-4xl mx-auto bg-white p-8 md:p-12 shadow-sm border border-gray-100 rounded-lg">
        
        {/* Page Heading */}
        <h1 className="text-3xl font-bold text-[#113463] mb-8 border-b pb-4">
          Terms of Use
        </h1>
        
        {/* Terms Content */}
        <div className="text-gray-600 space-y-6 leading-relaxed">
          <p className="text-sm text-gray-500 mb-6">
            <strong>Last Updated:</strong> June 2026
          </p>
          
          <p>
            Please read these Terms of Use carefully before using the AI Dermatologist website and application. By accessing or using our services, you agree to be bound by these terms.
          </p>
          
          {/* Section 1 */}
          <div>
            <h2 className="text-xl font-semibold text-[#113463] mt-6 mb-3">
              1. Medical Disclaimer
            </h2>
            <p>
              <strong>AI Dermatologist is NOT a replacement for professional medical advice, diagnosis, or treatment.</strong> The application is designed solely to provide users with the ability to image, track, and monitor areas of skin concern. Always seek the advice of a qualified healthcare provider or dermatologist with any questions you may have regarding a medical condition.
            </p>
          </div>
          
          {/* Section 2 */}
          <div>
            <h2 className="text-xl font-semibold text-[#113463] mt-6 mb-3">
              2. User Responsibilities
            </h2>
            <ul className="list-disc list-inside mt-2 space-y-2">
              <li>You must be at least 18 years old to use this service.</li>
              <li>You agree to provide accurate and complete information when creating an account.</li>
              <li>You are responsible for maintaining the confidentiality of your account login information.</li>
              <li>You agree not to upload inappropriate, offensive, or illegal images to the platform.</li>
            </ul>
          </div>

          {/* Section 3 */}
          <div>
            <h2 className="text-xl font-semibold text-[#113463] mt-6 mb-3">
              3. Intellectual Property
            </h2>
            <p>
              All content, features, and functionality on this website (including but not limited to text, graphics, logos, and AI algorithms) are the exclusive property of AI Dermatologist and are protected by international copyright and trademark laws.
            </p>
          </div>

          {/* Section 4 */}
          <div>
            <h2 className="text-xl font-semibold text-[#113463] mt-6 mb-3">
              4. Limitation of Liability
            </h2>
            <p>
              In no event shall AI Dermatologist, nor its directors, employees, or partners, be liable for any indirect, incidental, special, consequential, or punitive damages arising out of your use or inability to use the service.
            </p>
          </div>

          {/* Section 5 */}
          <div>
            <h2 className="text-xl font-semibold text-[#113463] mt-6 mb-3">
              5. Changes to Terms
            </h2>
            <p>
              We reserve the right to modify or replace these Terms at any time. We will notify you of any changes by posting the new Terms on this page. Your continued use of the service after any such changes constitutes your acceptance of the new Terms.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
};

export default TermsOfUse;