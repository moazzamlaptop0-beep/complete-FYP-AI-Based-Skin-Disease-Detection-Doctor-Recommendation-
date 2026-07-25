AI-Based Skin Disease Detection & Doctor Recommendation



An AI-powered platform that analyzes uploaded skin images, predicts possible skin conditions with a triage severity score (CRITICAL / URGENT / ROUTINE), and connects patients with doctors for consultation and appointment booking — with real-time slot sync and conflict resolution.

📑 Table of Contents
System Flow
Features
User Roles
How It Works
Tech Stack
AI Model
Installation
Environment Variables
Database Setup
Docker / Deployment
Testing
Project Structure
Key API Endpoints
Troubleshooting / FAQ
Roadmap
Acknowledgments
Contributing
License
📸 System Flow



✨ Features
🔍 AI Skin Disease Detection — Upload an image and get an instant prediction across 10 skin condition classes with a confidence score.
📷 Webcam Capture & Image Cropping — Take a photo directly in-browser or crop/compress uploaded images before submission.
🗺️ Doctor Map View — Browse doctors on an interactive map (Leaflet) based on location.
📄 PDF Report Export — Generate and download scan/consultation reports as PDFs.
💬 AI Chat Assistant — Gemini-powered chat assistant for patient queries.
🚦 Automated Triage System — Every scan is auto-classified as CRITICAL, URGENT, or ROUTINE based on the AI result and an optional symptom questionnaire.
📝 Pre-Report Questionnaire — Patients can optionally answer quick symptom questions (bleeding, fast growth, severe pain, irregular border, color change, diameter) to refine the triage score.
👨‍⚕️ Doctor Verification — Admins review and approve/reject doctor licenses before they go live.
📅 Smart Slot Booking — Doctor availability, breaks, fees, and buffer time are used to auto-generate free/booked appointment slots.
⚡ Conflict Resolution — Overlapping urgent bookings are flagged as Pending-Conflict, the doctor is notified by email, and unresolved conflicts auto-resolve via an SLA timeout.
🔄 Real-Time Sync — Doctor and patient dashboards stay live-updated via Server-Sent Events with a polling fallback.
⭐ Ratings & Reviews — Patients can rate and review doctors after a consultation.
🔐 Secure Auth — Password hashing (bcrypt/passlib) with email OTP verification and brute-force lockout protection.
🌐 Multi-language Support — Frontend i18n support (i18n.js) for localization.
👥 User Roles
Role	Capabilities
Patient (AI User)	Upload skin images, view AI predictions, fill pre-report questionnaire, book/manage appointments, rate doctors
Doctor	Get verified by admin, set availability/fees, review assigned scans, override AI severity, manage/resolve appointment conflicts
Admin	Review and approve/reject doctor license verification requests, oversee platform data
🩺 How It Works
Patient uploads a skin image → sent to the backend for analysis.
AI model predicts the condition and generates a triage score via /predict → CRITICAL, URGENT, or ROUTINE.
Optional pre-report questionnaire — patient can skip & send, or submit additional symptoms.
Report sent to doctor — a severity-based success screen is shown to the patient.
Based on severity:
ROUTINE → Doctor reviews the report on their own time via the dashboard.
URGENT / CRITICAL → Patient is prompted to "Book a Slot Immediately."
Doctor slots are generated from the doctor's schedule and consultation fee/duration settings (free/booked slots).
Patient books a slot via /api/book-slot.
If the slot is free → status becomes Scheduled.
If the slot is taken and the new request is urgent → both bookings move to Pending-Conflict and the doctor is emailed to resolve it manually.
Real-time sync keeps doctor and patient dashboards updated via Server-Sent Events (doctor-updates-stream, patient-updates-stream) with a 5s polling fallback. Conflicts are auto-resolved by an SLA timeout if the doctor doesn't respond in time.
🚀 Tech Stack

Frontend

React 19 + Vite 7
Tailwind CSS
React Router DOM (routing)
i18next / react-i18next (multi-language support)
Leaflet / React-Leaflet (interactive maps for doctor locations)
react-webcam (in-browser camera capture for skin images)
react-image-crop + browser-image-compression (image editing/optimization before upload)
jsPDF + html2canvas (generate downloadable PDF reports)
@google/generative-ai (Gemini-powered chat assistant on the frontend)
react-hot-toast (notifications), lucide-react / react-icons (icons)

Backend

Python — Flask & FastAPI
TensorFlow / Keras (skin disease prediction model — MobileNetV2)
SQLAlchemy + PostgreSQL (psycopg2-binary)
JWT (PyJWT) authentication + Passlib / Werkzeug security (password hashing)
Google Gemini AI (google-generativeai) — powers the /api/chat assistant
APScheduler — background job for SLA conflict auto-resolution
Uvicorn (ASGI server)
Server-Sent Events for real-time updates
🧠 AI Model

The prediction model is a MobileNetV2-based CNN, fine-tuned for skin disease classification.

Architecture: MobileNetV2 (no pretrained ImageNet weights) + Global Average Pooling + Dropout (0.40) + Dense output layer
Input size: 224 × 224 RGB images
Classes (10):
Eczema
Melanoma
Atopic Dermatitis
Basal Cell Carcinoma (BCC)
Melanocytic Nevi (NV)
Benign Keratosis Lesion (BKL)
Psoriasis, Lichen Planus & related diseases
Seborrheic Keratoses & other Benign Tumors
Tinea, Ringworm, Candidiasis & other Fungal Infections
Healthy Skin
Preprocessing: MobileNetV2's official preprocess_input
Confidence calibration: Temperature-scaled softmax (T = 3.5) for more realistic confidence scores
Weights file: FYP-backend/skindisease_best_model.weights.h5

⚠️ Current limitation: the model's prediction accuracy is not yet strong/reliable and is still a work in progress. Predictions should not be treated as a medical diagnosis — they're meant to assist triage/prioritization, with a real doctor always reviewing the case. Improving accuracy (more training data, better fine-tuning, class balancing) is on the roadmap.

You can test the model standalone (without running the full backend) using test_model.py:

bash
cd FYP-backend
python test_model.py

Place a test image named test.jpg in the FYP-backend folder before running, or edit the img_path in test_model.py's __main__ block to point to your own image.

📦 Installation
Prerequisites
Node.js (v18+) and npm
Python 3.10+
PostgreSQL database
1. Backend Setup
bash
cd FYP-backend

# (Recommended) create a virtual environment
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the backend server
python app.py

Note: A Python virtual environment (venv) is recommended so project dependencies stay isolated from your system Python. It is not strictly required, but avoids version conflicts.

2. Frontend Setup
bash
cd FYP-frontend

# Install dependencies
npm install

# Run the development server
npm run dev

Other available scripts:

bash
npm run build     # Production build
npm run preview   # Preview the production build locally
npm run lint      # Run ESLint

The frontend will typically be available at http://localhost:5173 and the backend at http://localhost:5000 (or as configured).

⚙️ Environment Variables

Create a .env file inside the FYP-backend folder with the following:

env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/dbname

# JWT Authentication
JWT_SECRET=your_strong_jwt_secret_key

# Email (used for OTP verification, password reset & doctor notifications)
# Note: uses Gmail SMTP (smtp.gmail.com:465) — use a Gmail App Password, not your normal password
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password

# Gemini AI (used for the /api/chat assistant feature)
GEMINI_API_KEY=your_google_gemini_api_key

⚠️ JWT_SECRET has a hardcoded fallback in app.py if not set — always set your own value in production, never rely on the default.

Create a .env file inside the FYP-frontend folder with:

env
VITE_API_URL=http://localhost:5000

This should point to wherever your FYP-backend server is running.

🗄️ Database Setup

This project uses PostgreSQL with SQLAlchemy as the ORM (FYP-backend/database.py handles the engine/session, FYP-backend/models.py defines the schema).

Create the database (using psql or any PostgreSQL client):
bash
   createdb skindisease_db
Set the connection string in FYP-backend/.env:
env
   DATABASE_URL=postgresql://user:password@localhost:5432/skindisease_db
Create the tables — run the following from inside FYP-backend/ (with your venv activated):
bash
   python -c "from database import Base, engine; import models; Base.metadata.create_all(bind=engine)"

If app.py already calls Base.metadata.create_all() on startup, tables are created automatically the first time you run python app.py.

Auto-seeding — app.py automatically seeds initial/default data (e.g. default records) into the database on startup, so no manual seed script needs to be run separately. Just start the backend with python app.py and the database will be ready to use.
Schema Overview
Table	Model	Purpose
users	User	Patients, Doctors & Admins (role-based), includes email OTP verification fields
doctor_profiles	DoctorProfile	Doctor's license, specialty, hospital, location, and admin verification status
ai_scans	AIScan	Uploaded skin images, AI prediction, confidence, triage severity/score, doctor review
doctor_availability	DoctorAvailability	Doctor's weekly schedule (day, start/end time, breaks, off-days)
doctor_fees	DoctorFees	Consultation fee (PKR/USD), duration, and buffer time between slots
appointments	Appointment	Booked slots, status, conflict tracking (conflict_with_id), SLA auto-resolution
doctor_ratings	DoctorRating	Patient ratings/reviews for doctors after appointments

⚠️ These tables have foreign key relationships (e.g., Appointment links to User, AIScan), so create them together in one create_all() call rather than individually to avoid FK errors.

📁 Project Structure
complete-FYP-AI-Based-Skin-Disease-Detection-Doctor-Recommendation/
│
├── FYP-backend/
│   ├── .gitattributes
│   ├── .gitignore
│   ├── Dockerfile
│   ├── README.md
│   ├── app.py                          # Main entry point
│   ├── database.py                     # DB connection/config
│   ├── models.py                       # DB models (SQLAlchemy)
│   ├── requirements.txt
│   ├── skindisease_best_model.weights.h5   # Trained AI model weights
│   └── test_model.py
│
├── FYP-frontend/
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   │   ├── ai-features/            # Upload/prediction UI
│   │   │   ├── auth/                   # Login/Signup
│   │   │   ├── dashboards/             # Doctor & patient dashboards
│   │   │   ├── doctor-directory/       # Doctor listing/search
│   │   │   ├── landing/                # Landing page
│   │   │   ├── layout/                 # Shared layout (navbar, footer, etc.)
│   │   │   └── widgets/                # Reusable UI widgets
│   │   ├── pages/
│   │   ├── App.jsx
│   │   ├── i18n.js
│   │   ├── index.css
│   │   └── main.jsx
│   ├── .gitignore
│   ├── .hintrc
│   ├── README.md
│   ├── eslint.config.js
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   └── vite.config.js
│
└── README.md
🔑 Key API Endpoints

All responses follow a consistent format: { "success": bool, "message"/"error": str, "data": ... }. Protected routes require Authorization: Bearer <token>.

Auth

Endpoint	Method	Description
/register	POST	Register a new user (Patient/Doctor)
/verify-otp-email	POST	Verify email via OTP
/resend-otp	POST	Resend OTP code
/login	POST	Login, returns JWT token
/forgot-password	POST	Request password reset
/reset-password	POST	Reset password

AI Scans & Reports

Endpoint	Method	Description
/predict	POST	Upload skin image → AI prediction + triage score
/send_report	POST	Send scan report to a doctor
/api/scans/<scan_id>/report-status	GET	Check report status
/api/override-severity/<scan_id>	POST	Doctor overrides AI-assigned severity
/doctor/update_scan/<scan_id>	PUT	Doctor updates scan (comment, status)
/doctor/delete_scan/<scan_id>	DELETE	Delete a scan
/patient/scans/<user_id>	GET	Get a patient's scan history
/doctor/scans/<doctor_id>	GET	Get scans assigned to a doctor

Doctors & Admin

Endpoint	Method	Description
/api/doctors/public	GET	Public doctor directory
/api/doctors	GET	List doctors
/api/doctor/profile	GET/POST	Get/update doctor profile
/admin/stats	GET	Admin dashboard stats
/admin/doctors	GET	List doctors for admin review
/admin/doctors/<doctor_id>/verify	PUT	Approve/reject doctor license
/admin/doctors/<doctor_id>	DELETE	Remove a doctor

Availability, Fees & Slots

Endpoint	Method	Description
/api/update-availability	POST	Set doctor's weekly schedule
/api/doctor-availability/<doctor_id>	GET	Get doctor's schedule
/api/update-fees	POST	Set consultation fees/duration
/api/doctor-fees/<doctor_id>	GET	Get doctor's fees
/api/slots/<doctor_id>	GET	Get available/booked slots

Appointments

Endpoint	Method	Description
/api/book-slot	POST	Book an appointment slot
/api/resolve-conflict/<appointment_id>	PUT	Doctor resolves a booking conflict
/api/doctor-appointments/<doctor_id>	GET	Doctor's appointments
/api/patient-appointments/<patient_id>	GET	Patient's appointments
/api/update-appointment/<appt_id>	PUT	Update an appointment
/api/delete-appointment/<appt_id>	DELETE	Cancel/delete an appointment

Real-Time, Ratings & AI Chat

Endpoint	Method	Description
/api/doctor-updates-stream/<doctor_id>	GET	SSE stream for doctor dashboard
/api/patient-updates-stream/<patient_id>	GET	SSE stream for patient dashboard
/api/rate-doctor	POST	Submit a doctor rating/review
/api/doctor/ratings	GET	Get ratings for logged-in doctor
/doctor/ratings/<doctor_id>	GET	Get public ratings for a doctor
/api/chat	POST	AI chat assistant (powered by Google Gemini)
🐳 Docker / Deployment (Future)

ℹ️ The Dockerfile in FYP-backend is not part of the current running project — it's kept in place for a future Hugging Face Spaces deployment and is not being used or deployed right now. You can safely ignore it if you're just running the project locally with python app.py / npm run dev.

For reference, here's what it currently contains (for when deployment happens):

dockerfile
FROM python:3.10
WORKDIR /code
COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]

⚠️ Note for when deployment is attempted: the CMD currently runs uvicorn main:app, which expects an ASGI app named app inside main.py. The actual backend entry point is app.py, a Flask (WSGI) app run via app.run(). This will need to be fixed before it works — either change the CMD to ["python", "app.py"] / run via gunicorn app:app, or wrap the Flask app with an ASGI adapter (e.g. asgiref.wsgi.WsgiToAsgi) if uvicorn is required for the Space.

🧪 Testing
🧪 Testing
FYP-backend/test_model.py — standalone script to sanity-check the AI model's predictions outside of the API (loads weights, runs inference on a sample image, prints the top prediction with confidence and top-3 raw logits in debug mode).
bash
cd FYP-backend
python test_model.py
🛠️ Troubleshooting / FAQ

"Weights file nahi mili" / model fails to load Make sure skindisease_best_model.weights.h5 exists inside FYP-backend/ (it's loaded via an absolute path relative to the script). If missing, re-download/add the weights file — the app can't run predictions without it.

"Internal server error" on register/login Usually means DATABASE_URL isn't set correctly or PostgreSQL isn't running. Double-check your .env and that the database exists (see Database Setup).

OTP email not received The backend uses Gmail SMTP (smtp.gmail.com:465) with EMAIL_USER / EMAIL_PASS. You need a Gmail App Password (not your regular Gmail password) — regular passwords are rejected by Gmail for SMTP. Also check spam folder.

"Token is missing!" / "Session expired!" errors Protected routes require an Authorization: Bearer <token> header. Tokens are JWTs signed with JWT_SECRET — make sure the frontend stores and sends the token returned by /login, and that JWT_SECRET hasn't changed between login and the request (which would invalidate old tokens).

403 "Access denied" errors Some routes are role-restricted (@admin_required, @doctor_required, @patient_required). Make sure you're logged in with the correct role for that endpoint.

/api/chat returns an error This endpoint uses Google Gemini — make sure GEMINI_API_KEY is set in .env and is a valid, active API key.

File upload fails / 413 error Uploaded images are capped at 10 MB (MAX_CONTENT_LENGTH) and must be png, jpg, jpeg, or webp.

Doctor dashboard / patient dashboard not updating in real time Confirm the SSE endpoints (/api/doctor-updates-stream/<id>, /api/patient-updates-stream/<id>) are reachable — some proxies/browsers buffer SSE, and the frontend falls back to 5s polling if the stream drops.

Docker container fails to start / "main:app not found" (only relevant when the future Hugging Face deployment is attempted) The Dockerfile is not used for local development — it's only for the future HF Spaces deployment (see Docker / Deployment). When that's attempted, note the CMD currently points to uvicorn main:app, but the real Flask entry point is app.py. This will need fixing (or a main.py ASGI wrapper) before the container will run.

Frontend can't reach the backend (network error on API calls) Check VITE_API_URL in FYP-frontend/.env — it must point to your running backend (e.g. http://localhost:5000). Also make sure the Flask backend has CORS enabled (it does, via flask-cors).

🛣️ Roadmap
 Improve AI model accuracy (more/better training data, fine-tuning, class balancing)
 Deploy AI model backend on Hugging Face Spaces
 Add automated unit/integration tests for API endpoints
 Expand AI model to cover more skin condition classes
 Add push notifications (not just email) for urgent triage cases
 Video consultation support
 Admin analytics dashboard
 CI/CD pipeline for automated deployment
🙏 Acknowledgments
MobileNetV2 architecture (TensorFlow/Keras Applications) for the base AI model
Open-source skin disease image datasets used for training (e.g., dermatology image collections covering Eczema, Melanoma, BCC, Psoriasis, and related conditions)
Built with React, Vite, Flask/FastAPI, TensorFlow, and PostgreSQL
This project was developed as a Final Year Project (FYP)
🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request for any bug fixes or feature suggestions.

📄 License

This project is licensed under the MIT License.
