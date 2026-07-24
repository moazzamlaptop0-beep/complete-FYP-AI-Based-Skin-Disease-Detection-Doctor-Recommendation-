import React from 'react';
import { Link } from 'react-router-dom'; // 🚀 React Router se Link import kiya

const Footer = () => {
  const links = [
    "FAQ", 
    "Privacy Policy", 
    "Terms of use"
  ];

  return (
    <footer className="w-full bg-[#113463] py-12 px-6 font-sans text-white">
      <div className="max-w-7xl mx-auto flex flex-col gap-8">
        
        {/* Top Links */}
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-[15px]">
          {links.map((link, index) => {
            // 🚀 Har link ka text (jaise "Privacy Policy") ko path ("/privacy-policy") mein convert kiya
            const path = `/${link.toLowerCase().replace(/ /g, '-')}`;
            
            return (
              <Link 
                key={index} 
                to={path} 
                className="underline underline-offset-4 decoration-1 hover:text-cyan-300 transition-colors"
              >
                {link}
              </Link>
            );
          })}
        </div>

        {/* Middle Text Content */}
        <div className="flex flex-col gap-4 text-[15px] max-w-4xl">
          <p className="leading-relaxed">
            AI Dermatologist is not intended to perform diagnosis, but rather to provide users the ability to image, track, and monitor any areas of skin concern.
          </p>
          <p className="text-[#8ba7ce]">
            If you have any questions about our AI system, contact us via email{' '}
            <a href="mailto:support@ai-derm.com" className="font-bold text-white hover:underline">
              support@ai-derm.com
            </a>
          </p>
        </div>

        {/* Bottom Section: Social Icons & Copyright */}
        <div className="flex flex-col md:flex-row items-center md:justify-start mt-10 gap-6 md:gap-10">
          
          {/* Social Icons (Ab yeh Left side par aayenge) */}
          <div className="flex items-center gap-3">
            {/* Facebook */}
            <a href="#" className="w-9 h-9 border border-white rounded-[4px] flex items-center justify-center hover:bg-white/10 transition-colors">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z"/>
              </svg>
            </a>
            
            {/* LinkedIn */}
            <a href="#" className="w-9 h-9 border border-white rounded-[4px] flex items-center justify-center hover:bg-white/10 transition-colors">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M4.98 3.5c0 1.381-1.11 2.5-2.48 2.5s-2.48-1.119-2.48-2.5c0-1.38 1.11-2.5 2.48-2.5s2.48 1.12 2.48 2.5zm.02 4.5h-5v16h5v-16zm7.982 0h-4.968v16h4.969v-8.399c0-4.67 6.029-5.052 6.029 0v8.399h4.988v-10.131c0-7.88-8.922-7.593-11.018-3.714v-2.155z"/>
              </svg>
            </a>
            
            {/* Twitter */}
            <a href="#" className="w-9 h-9 border border-white rounded-[4px] flex items-center justify-center hover:bg-white/10 transition-colors">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/>
              </svg>
            </a>
            
            {/* Instagram */}
            <a href="#" className="w-9 h-9 border border-white rounded-[4px] flex items-center justify-center hover:bg-white/10 transition-colors">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4s1.791-4 4-4 4 1.79 4 4-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
            </a>

            {/* Telegram */}
            <a href="#" className="w-9 h-9 border border-white rounded-[4px] flex items-center justify-center hover:bg-white/10 transition-colors">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
            </a>
          </div>

          {/* Copyright Text */}
          <p className="text-[#8ba7ce] text-[15px] text-center md:text-left">
            AI Dermatologist | All Rights Reserved. Copyright © 2026
          </p>

        </div>
      </div>
    </footer>
  );
};

export default Footer;