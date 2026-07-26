/**
 * features/auth — the unified auth screen.
 *
 * MOUNTING (what the App.jsx step needs)
 * --------------------------------------
 *   <Route path="/login"    element={<AuthPage />} />
 *   <Route path="/register" element={<AuthPage mode="signup" />} />   // same flow, different copy
 *   <Route path="/auth"     element={<AuthPage />} />                 // optional alias
 *
 * `/login` is the canonical one: `RequireAuth.AUTH_ROUTE` already points there,
 * AppNavbar and MobileDrawer already link there, and it is what every existing
 * `?returnTo=` redirect targets. Keeping `/register` mounted (rather than
 * deleting it) means the navbar's "Sign up" button needs no change and any
 * bookmark still lands somewhere sensible — the flow is email-first either way,
 * so a returning user typing `/register` is routed to the password step, not
 * pushed into making a second account.
 *
 * `AuthPage` reads `?returnTo=` (RequireAuth writes it) and `?email=`, and
 * refuses any returnTo that is not a same-origin absolute path.
 */

export { default as AuthPage } from './AuthPage';
export { default } from './AuthPage';

export { resolveReturnTo } from './returnTo';
export { buildConsentPayload, missingMandatory } from './consentPayload';

export {
  default as useAuthMachine,
  STATES,
  STATE_BY_NEXT,
  clearFlowSnapshot,
  describeError,
  FLOW_KEY,
  FLOW_TTL_MS,
  initialMachineState,
  isEmailShaped,
  readFlowSnapshot,
  reducer,
  stateForCheckEmail,
  stateFromSnapshot,
} from './useAuthMachine';

export { default as useConsentDocuments } from './useConsentDocuments';

export {
  OTP_MAX_ATTEMPTS,
  OTP_PURPOSE,
  OTP_RESEND_COOLDOWN_SECONDS,
  ROLE_DOCTOR,
  ROLE_PATIENT,
  doctorVerificationStatus,
  establishSession,
  isDoctorAwaitingApproval,
  secondsFromCooldownMessage,
} from './authApi';

export {
  DEFAULT_MIN_LENGTH,
  LEVELS as PASSWORD_LEVELS,
  checkPasswordPolicy,
  scorePassword,
} from './passwordStrength';

/* -------------------------------- components ------------------------------ */
export { default as AuthShell } from './components/AuthShell';
export { default as EmailChip } from './components/EmailChip';
export { default as PasswordInput } from './components/PasswordInput';
export { default as PasswordStrengthMeter } from './components/PasswordStrengthMeter';

/* ---------------------------------- steps --------------------------------- */
// ClinicLocationPicker is deliberately NOT re-exported here. It is the only
// module in this feature that imports Leaflet, and DoctorFields loads it with
// `React.lazy` so the map lands in its own chunk. A static re-export from this
// barrel would drag leaflet + leaflet.css + the marker sprites straight back
// into the sign-in bundle, which is the exact thing the lazy import prevents.
// Import it from './steps/ClinicLocationPicker' if you ever need it directly.
export { default as ConsentBlock } from './steps/ConsentBlock';
export { default as DoctorFields } from './steps/DoctorFields';
export { default as DoctorPendingStep } from './steps/DoctorPendingStep';
export { default as EmailStep } from './steps/EmailStep';
export { default as OtpStep } from './steps/OtpStep';
export { default as PasswordStep } from './steps/PasswordStep';
export { default as ResetPasswordStep } from './steps/ResetPasswordStep';
export { default as ResetRequestStep } from './steps/ResetRequestStep';
export { default as SignupDetailsStep } from './steps/SignupDetailsStep';
