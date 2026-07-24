import React from 'react';

const FAQ = () => {
  return (
    <div className="min-h-screen bg-gray-50 py-16 px-6 font-sans">
      <div className="max-w-4xl mx-auto bg-white p-8 md:p-12 shadow-sm border border-gray-100 rounded-lg">
        
        {/* Page Heading */}
        <h1 className="text-3xl font-bold text-[#113463] mb-8 border-b pb-4">
          Frequently Asked Questions (FAQ)
        </h1>
        
        {/* Questions & Answers Container */}
        <div className="space-y-8">
          
          {/* Question 1 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800">
              1. How does the AI Dermatologist work?
            </h3>
            <p className="text-gray-600 mt-2 leading-relaxed">
              Our AI system analyzes the images you upload to track and monitor skin concerns. It uses advanced algorithms to compare your image with thousands of dermatological cases to provide insights.
            </p>
          </div>

          {/* Question 2 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800">
              2. Is this a replacement for a real doctor?
            </h3>
            <p className="text-gray-600 mt-2 leading-relaxed">
              No. AI Dermatologist is not intended to perform medical diagnosis. It is a tracking and monitoring tool. You should always consult a certified dermatologist or healthcare professional for real medical advice.
            </p>
          </div>

          {/* Question 3 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800">
              3. Is my data and uploaded images secure?
            </h3>
            <p className="text-gray-600 mt-2 leading-relaxed">
              Yes, we prioritize your privacy. All uploaded images are encrypted and strictly used for the purpose of monitoring your skin health. We do not share your personal data with third parties.
            </p>
          </div>

          {/* Question 4 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800">
              4. How can I contact support?
            </h3>
            <p className="text-gray-600 mt-2 leading-relaxed">
              If you have any questions or face any issues, you can contact our support team directly via email at <a href="mailto:support@ai-derm.com" className="text-[#113463] hover:underline font-medium">support@ai-derm.com</a>.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
};

export default FAQ;