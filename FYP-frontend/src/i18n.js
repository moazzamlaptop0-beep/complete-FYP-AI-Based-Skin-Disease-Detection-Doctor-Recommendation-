import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      "lang_code": "Urdu",
      "faq": "FAQ",
      "dictionary": "Dictionary",
      "dashboard": "Dashboard",
      "my_reports": "My Reports",
      "register": "Register",
      "login": "Log In",
      "logout": "Logout"
    }
  },
  ur: {
    translation: {
      "lang_code": "English",
      "faq": "عمومی سوالات",
      "dictionary": "ڈکشنری",
      "dashboard": "ڈیش بورڈ",
      "my_reports": "میری رپورٹس",
      "register": "رجسٹر",
      "login": "لاگ ان",
      "logout": "لاگ آؤٹ"
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false }
  });

export default i18n;