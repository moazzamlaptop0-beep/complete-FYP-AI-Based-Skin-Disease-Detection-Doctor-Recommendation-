/**
 * FloatingChatbot — the global AI assistant launcher and panel.
 * ============================================================================
 *
 * WHAT WAS WRONG, AND WHAT CHANGED
 * --------------------------------
 * 1. STACKING / HIT-TESTING. The widget was `z-toast` (1700), the top layer in
 *    the whole system, so it painted ON TOP of every Modal (z-modal, 1400) and
 *    Drawer scrim. Clicking it while a dialog was open fought that dialog's
 *    focus trap, which is the "sometimes does not open" report. It now sits at
 *    `z-sticky`, i.e. in the same chrome layer as the navbar and the tab bar and
 *    strictly BELOW dropdown / overlay / modal / popover / tooltip / toast, and
 *    `useOverlayPresence()` removes it from the page entirely (display:none, so
 *    it leaves the a11y tree and the tab order too) while an overlay is up.
 *
 * 2. BOTTOM-BAR COLLISION. `bottom-6` put the launcher on top of MobileTabBar
 *    and of the consult wizard's sticky Back/Next bar on phones. It is now
 *    offset above them below `md`, with the iOS safe-area inset added, and
 *    back to `bottom-6` from `md` up where neither bar exists.
 *
 * 3. STALE IDENTITY. The role was read ONCE from localStorage in a useState
 *    initialiser, so signing in or out left the wrong persona, greeting and
 *    placeholder behind until a full reload, and it bypassed `lib/storage`
 *    entirely. It now comes from `useOptionalAuth()` (non-throwing, because this
 *    widget renders outside any provider-guarded subtree) and every persona
 *    value is derived, so it tracks login/logout live. The greeting is DERIVED
 *    rather than seeded into `messages`, which is what lets it re-word itself on
 *    a role change without duplicating a greeting or wiping the conversation.
 *
 * 4. KEYBOARD. Opening moves focus to the composer, Escape closes and returns
 *    focus to the launcher, and the panel is a labelled `role="dialog"`. It is
 *    deliberately NOT `aria-modal`: the page stays usable behind it.
 *
 * 5. LIVE REGION. `aria-live="polite"` used to sit on the whole scrolling
 *    thread, so every reply re-read the entire conversation. The thread is now
 *    `aria-live="off"` and one small visually-hidden region carries ONLY the
 *    newest reply (or the newest failure).
 *
 * 6. ERRORS. Failures used to be pushed in as a bot message starting "Error:",
 *    indistinguishable from real assistant content. They are now a real error
 *    row with a Retry that re-sends the last user message, and "the backend is
 *    unreachable" (ApiError.status === 0) reads differently from "the server
 *    answered with a failure". The user's text is never lost: it stays in the
 *    thread as their own bubble and Retry re-sends it verbatim.
 *
 * DESIGN
 * ------
 * Every colour is a flipping token, so the widget belongs to the page in both
 * themes. The old header used the FIXED `navy`/`aqua` brand ramps with white
 * text, which is why it looked pasted-on beside a light panel. There is exactly
 * ONE gradient left in the widget, on the launcher, and it is the both-theme
 * recipe (`from-primary-600 to-accent-700 dark:from-primary-400
 * dark:to-accent-300`) whose light and dark stops resolve to the SAME two
 * physical colours, both AA under white. The three role personas survive as
 * tonal chips (`bg-{scale}-100 text-{scale}-700`) instead of three different
 * dark gradients.
 *
 * SAFETY
 * ------
 * `normalizeAiText` enforces the product copy rule on model output, and
 * `renderMessageText` / `renderInlineText` build React children by hand so
 * nothing the model emits can become markup. There is no `dangerouslySetInnerHTML`
 * anywhere in this file and there must never be.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Brain,
  RotateCcw,
  Send,
  ServerCrash,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  User,
  WifiOff,
  X,
} from 'lucide-react';

import api, { ApiError } from '../../lib/api';
import endpoints from '../../lib/endpoints';
import { cn } from '../../lib/cn';
import { useOptionalAuth } from '../../context/AuthContext';
import { focusRing } from '../ui/Button';
import Spinner from '../ui/Spinner';
import { usePresence } from '../ui/Overlay';
import useOverlayPresence from './useOverlayPresence';

/* ------------------------------------------------------------------------- */
/* AI text cleanup                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Normalize assistant text before it is rendered. Product rule: AI-generated
 * copy must not show dash-style punctuation, so em/en dashes used as
 * punctuation (" — ", " – ", "a—b") and double hyphens ("--") all collapse
 * to a plain comma + space. Newlines are preserved (the character classes
 * below deliberately exclude them so list layout survives).
 */
const normalizeAiText = (text) => {
  if (typeof text !== "string") return "";
  return text
    .replace(/[ \t]*[—–][ \t]*/g, ", ")
    .replace(/[ \t]*--+[ \t]*/g, ", ");
};

/* ------------------------------------------------------------------------- */
/* Safe message rendering (no HTML injection possible)                       */
/* ------------------------------------------------------------------------- */

/**
 * Convert the "**bold**" spans within a single line into React elements.
 * Everything outside the markers stays a plain string, so nothing the model
 * (or an error message) emits can ever become markup.
 */
const renderInlineText = (line, keyPrefix) => {
  const parts = [];
  const boldPattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match;
  let boldIndex = 0;

  while ((match = boldPattern.exec(line)) !== null) {
    if (match.index > cursor) {
      parts.push(line.slice(cursor, match.index));
    }
    parts.push(
      <strong key={`${keyPrefix}-b${boldIndex}`}>{match[1]}</strong>
    );
    cursor = boldPattern.lastIndex;
    boldIndex += 1;
  }
  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }
  return parts;
};

/** Split a message on newlines and render each line as plain React children. */
const renderMessageText = (text) => {
  const safeText = typeof text === "string" ? text : "";
  return safeText.split("\n").map((line, lineIndex) => (
    <React.Fragment key={`line-${lineIndex}`}>
      {lineIndex > 0 && <br />}
      {renderInlineText(line, `line-${lineIndex}`)}
    </React.Fragment>
  ));
};

const timeNow = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Auto-scroll is an animation too. Tailwind's `motion-reduce:` variant covers
 * the CSS; `scrollIntoView({behavior:'smooth'})` has to be asked in JS.
 */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------------- */
/* Personas                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * One entry per role. The persona is expressed as a TONAL CHIP
 * (`bg-{scale}-100 text-{scale}-700`) rather than a whole dark header gradient,
 * so all three read as the same component wearing a different accent, and all
 * three flip correctly with the theme.
 */
const PERSONAS = Object.freeze({
  Admin: {
    title: 'System assistant',
    chip: 'bg-primary-100 text-primary-700',
    Icon: ShieldCheck,
    placeholder: 'Ask a system question',
    greeting:
      'Hello Admin! I am your System Assistant. Need help managing the platform or checking stats?',
  },
  Doctor: {
    title: 'Clinical assistant',
    chip: 'bg-accent-100 text-accent-700',
    Icon: Stethoscope,
    placeholder: 'Ask a clinical question',
    greeting:
      'Hello Doctor! I am your Clinical AI Assistant. How can I help you with dermatological analysis or medical queries today?',
  },
  // Patients and anonymous visitors share one persona.
  'AI User': {
    title: 'Derma AI assistant',
    chip: 'bg-info-100 text-info-700',
    Icon: Brain,
    placeholder: 'Ask about your skin',
    greeting:
      'Hello! I am your AI Derma Assistant. How can I help you with your skin concerns today?',
  },
});

const ROLE_LABELS = Object.freeze({
  Admin: 'Admin',
  Doctor: 'Doctor',
  'AI User': 'Patient',
});

/** Copy for the two distinct failure modes. Kept apart on purpose. */
const OFFLINE_ERROR = Object.freeze({
  tone: 'offline',
  title: 'Cannot reach the assistant',
  body: 'The chat service did not answer. Check your connection, then try again.',
});
const SERVER_ERROR_TITLE = 'The assistant could not reply';
const SERVER_ERROR_BODY = 'Something went wrong on our side. Please try again.';

const isErrorRow = (message) => message.kind === 'error';

const FloatingChatbot = () => {
  /* ---------------------------------------------------------------- identity */
  // `useOptionalAuth` (not `useAuth`) because this widget is mounted next to the
  // router in App.jsx and must not throw if it ever renders outside the
  // provider, e.g. in a test that mounts App bare.
  const auth = useOptionalAuth();
  // `effectiveRole` rather than `role`, so an admin acting as a doctor gets the
  // clinical persona, exactly like the rest of the chrome. Falls back to the
  // patient/guest persona for anonymous visitors.
  const role = auth?.effectiveRole || auth?.role || null;
  const persona = PERSONAS[role] || PERSONAS['AI User'];
  const roleLabel = ROLE_LABELS[role] || 'Guest';
  const isPatientOrGuest = persona === PERSONAS['AI User'];
  const PersonaIcon = persona.Icon;

  /* ------------------------------------------------------------------- state */
  const [isOpen, setIsOpen] = useState(false);
  /** The invitation nudge is a first-visit affordance, not a permanent bouncer. */
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
  const [draft, setDraft] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  /**
   * ONLY the real exchanges. The greeting is derived below instead of being
   * seeded in here: that is what lets a role change re-word it live without
   * either duplicating a greeting or throwing away an in-progress conversation.
   */
  const [messages, setMessages] = useState([]);
  /** The newest reply (or failure) and nothing else, for the live region. */
  const [announcement, setAnnouncement] = useState('');
  /** Mount time, so the greeting's timestamp is stable across re-renders. */
  const [greetingTime] = useState(timeNow);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const launcherRef = useRef(null);
  const idRef = useRef(0);
  const nextId = () => {
    idRef.current += 1;
    return idRef.current;
  };

  const overlayOpen = useOverlayPresence();
  const { mounted, state } = usePresence(isOpen, 220);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const panelId = `${baseId}-panel`;

  const greeting = useMemo(
    () => ({ id: 'greeting', kind: 'bot', text: persona.greeting, time: greetingTime }),
    [persona.greeting, greetingTime],
  );
  const thread = useMemo(() => [greeting, ...messages], [greeting, messages]);

  /* ------------------------------------------------------------- networking */
  /**
   * Goes through the shared client rather than a hand-rolled fetch: it owns the
   * base URL, attaches the bearer token when there is one, and unwraps the
   * {success,data,error} envelope. The chat route accepts anonymous callers, so
   * no token is fine.
   *
   * Every failure from `api` is an ApiError, and `status === 0` means the
   * request never reached a server. That is the one case worth its own copy.
   */
  const sendToAssistant = useCallback(async (text) => {
    setIsTyping(true);
    try {
      const data = await api.post(endpoints.chat.send(), { message: text });
      const reply = normalizeAiText(data?.reply || 'No response received.');
      setMessages((prev) => [
        ...prev.filter((message) => !isErrorRow(message)),
        { id: nextId(), kind: 'bot', text: reply, time: timeNow() },
      ]);
      setAnnouncement(reply);
    } catch (error) {
      const unreachable = error instanceof ApiError ? error.isNetworkError : true;
      if (!unreachable) console.error('Chat request failed:', error);
      const row = unreachable
        ? { ...OFFLINE_ERROR }
        : {
            tone: 'server',
            title: SERVER_ERROR_TITLE,
            body: (error instanceof ApiError && error.message) || SERVER_ERROR_BODY,
          };
      setMessages((prev) => [
        ...prev.filter((message) => !isErrorRow(message)),
        { id: nextId(), kind: 'error', retryText: text, time: timeNow(), ...row },
      ]);
      setAnnouncement(`${row.title}. ${row.body}`);
    } finally {
      setIsTyping(false);
    }
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isTyping) return;

    setDraft('');
    setMessages((prev) => [
      ...prev.filter((message) => !isErrorRow(message)),
      { id: nextId(), kind: 'user', text, time: timeNow() },
    ]);
    sendToAssistant(text);
  };

  /** Re-send the message that failed. Its bubble is already in the thread. */
  const handleRetry = (text) => {
    if (!text || isTyping) return;
    setMessages((prev) => prev.filter((message) => !isErrorRow(message)));
    sendToAssistant(text);
  };

  /* --------------------------------------------------------------- open/close */
  const open = () => {
    setIsOpen(true);
    setHasOpenedOnce(true);
  };

  /** Closing always hands focus back to the launcher the user came from. */
  const close = useCallback(() => {
    setIsOpen(false);
    // Emptied so re-opening the panel cannot re-announce a reply the user has
    // already heard: some screen readers speak a live region's contents when the
    // region itself is inserted, and the region unmounts with the panel.
    setAnnouncement('');
    launcherRef.current?.focus?.({ preventScroll: true });
  }, []);

  /** Esc closes from anywhere in the widget, including from the launcher. */
  const handleKeyDown = (event) => {
    if (event.key !== 'Escape' || !isOpen) return;
    // The panel is not modal, but a stray Esc must not also reach a host page
    // listener and close something behind it.
    event.stopPropagation();
    close();
  };

  // Focus the composer on open. rAF because the panel mounts in its "closed"
  // transform for one frame and focusing a zero-opacity element can be skipped
  // by some browsers.
  useEffect(() => {
    if (!isOpen || overlayOpen) return undefined;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus?.({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, overlayOpen]);

  // Keep the newest row in view.
  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [thread, isTyping, isOpen]);

  /* ------------------------------------------------------------------ styles */
  const hasDraft = draft.trim().length > 0;

  const bubbleBase =
    'max-w-full break-words rounded-2xl px-3.5 py-2.5 text-body-sm shadow-soft';
  // `border-default`, never `border-subtle`: in light mode `--color-line-subtle`
  // and `--color-surface-sunken` are the SAME rgb, so a subtle border on a bot
  // bubble would be invisible against this thread's sunken background.
  const botBubble = cn(bubbleBase, 'rounded-bl-md border border-default bg-surface text-default');
  // The user's own bubble is a tonal fill rather than the gradient: the gradient
  // is spent on the launcher, and `bg-primary-100 / text-primary-900` flips as a
  // pair so it needs no `dark:` override and stays AA in both themes.
  const userBubble = cn(bubbleBase, 'rounded-br-md bg-primary-100 text-primary-900');

  const avatarBase = 'flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-pill';

  return (
    <div
      onKeyDown={handleKeyDown}
      className={cn(
        // z-sticky, NOT z-toast: above ordinary page content and level with the
        // rest of the app chrome, but strictly below z-dropdown (1200),
        // z-overlay (1300), z-modal (1400), z-popover, z-tooltip and z-toast.
        'fixed right-4 z-sticky flex flex-col items-end md:right-6',
        // Above MobileTabBar and above the consult wizard's sticky action bar on
        // phones (both `sticky bottom-0`), plus the iPhone home-indicator inset.
        'bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-6',
        // While a Modal or Drawer owns the screen the widget leaves the page
        // completely: display:none takes it out of the a11y tree and the tab
        // order, so it can neither be clicked through a scrim nor fight the
        // dialog's focus trap.
        overlayOpen && 'hidden',
      )}
    >
      {/* -------------------------------------------------------------- PANEL */}
      {mounted && (
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className={cn(
            'mb-3 flex w-[calc(100vw-2rem)] max-w-[24rem] flex-col overflow-hidden',
            'rounded-modal border border-subtle bg-surface shadow-overlay',
            'h-[min(32rem,calc(100dvh-11rem))] md:h-[min(34rem,calc(100dvh-7rem))]',
            'origin-bottom-right transition-[opacity,transform] duration-200 ease-overshoot',
            'motion-reduce:transition-none',
            state === 'open'
              ? 'translate-y-0 scale-100 opacity-100'
              : 'pointer-events-none translate-y-3 scale-95 opacity-0',
          )}
        >
          {/* ---------------------------------------------------------- header */}
          <div className="flex items-center gap-3 border-b border-default bg-surface px-4 py-3">
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-pill', persona.chip)}>
              <PersonaIcon className="h-5 w-5" aria-hidden="true" />
            </span>

            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-heading-sm text-default">
                {persona.title}
              </h2>
              <p className="mt-1 flex items-center gap-2 text-caption text-subtle">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-pill bg-success-500" aria-hidden="true" />
                  Online
                </span>
                <span className={cn('rounded-pill px-2 py-0.5 text-label-sm', persona.chip)}>
                  {roleLabel}
                </span>
              </p>
            </div>

            <button
              type="button"
              onClick={close}
              aria-label="Close chat"
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-pill',
                'text-muted transition-colors hover:bg-surface-sunken hover:text-default',
                'motion-reduce:transition-none',
                focusRing,
              )}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* --------------------------------------------------------- thread */}
          {/* `aria-live="off"`: the whole log must NOT be re-read on every
              reply. The single hidden region below announces just the newest
              one. `tabIndex` keeps this scrollable area keyboard reachable. */}
          <div
            role="log"
            aria-live="off"
            aria-label="Conversation"
            tabIndex={0}
            className={cn(
              'ui-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto bg-surface-sunken px-4 py-4',
              'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
            )}
          >
            {thread.map((message) => {
              if (isErrorRow(message)) {
                const ErrorIcon = message.tone === 'offline' ? WifiOff : ServerCrash;
                return (
                  <div
                    key={message.id}
                    className="rounded-card border border-danger-200 bg-danger-50 p-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <ErrorIcon
                        className="mt-0.5 h-4 w-4 shrink-0 text-danger-600"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-label-md text-danger-900">{message.title}</p>
                        <p className="mt-0.5 text-caption text-danger-900">{message.body}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRetry(message.retryText)}
                      className={cn(
                        'mt-2.5 inline-flex items-center gap-1.5 rounded-control px-2 py-1',
                        'text-label-md text-danger-900 transition-colors hover:bg-danger-100',
                        'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                        'motion-reduce:transition-none',
                      )}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Try again
                    </button>
                  </div>
                );
              }

              const isUser = message.kind === 'user';
              return (
                <div
                  key={message.id}
                  className={cn('flex w-full gap-2', isUser ? 'justify-end' : 'justify-start')}
                >
                  {!isUser && (
                    <span className={cn(avatarBase, persona.chip)}>
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  )}

                  <div
                    className={cn(
                      'flex min-w-0 max-w-[80%] flex-col gap-1',
                      isUser ? 'items-end' : 'items-start',
                    )}
                  >
                    <div className={isUser ? userBubble : botBubble}>
                      <div className="leading-relaxed">{renderMessageText(message.text)}</div>
                    </div>
                    <span className="px-1 text-caption text-subtle">{message.time}</span>
                  </div>

                  {isUser && (
                    <span className={cn(avatarBase, 'border border-default bg-surface text-muted')}>
                      <User className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  )}
                </div>
              );
            })}

            {/* --------------------------------------------- typing indicator */}
            {isTyping && (
              <div className="flex w-full items-start gap-2">
                <span className={cn(avatarBase, persona.chip)}>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {/* `bg-current` inherits `text-subtle`, so the dots are a token
                    and flip with the theme instead of sitting on a fixed grey. */}
                <div
                  className={cn(botBubble, 'flex items-center gap-1 text-subtle')}
                  aria-hidden="true"
                >
                  <span className="h-1.5 w-1.5 animate-bounce rounded-pill bg-current motion-reduce:animate-none" />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-pill bg-current motion-reduce:animate-none"
                    style={{ animationDelay: '0.15s' }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-pill bg-current motion-reduce:animate-none"
                    style={{ animationDelay: '0.3s' }}
                  />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Newest reply only, so a screen reader is not read the whole thread
              again every time the assistant answers. */}
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>

          {/* ------------------------------------------------------- composer */}
          {/* The input is never disabled: the next question can be composed
              while the assistant is still answering. Only Send waits. */}
          <form onSubmit={handleSubmit} className="border-t border-default bg-surface p-3">
            <div
              className={cn(
                'flex items-center gap-2 rounded-pill border border-default bg-surface-sunken py-1.5 pl-4 pr-1.5',
                'transition-colors focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/30',
                'motion-reduce:transition-none',
              )}
            >
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={persona.placeholder}
                aria-label="Chat message"
                autoComplete="off"
                className={cn(
                  'min-w-0 flex-1 bg-transparent py-1.5 text-body-sm text-default',
                  'outline-none placeholder:text-subtle',
                )}
              />
              <button
                type="submit"
                disabled={!hasDraft}
                aria-disabled={isTyping || undefined}
                aria-busy={isTyping || undefined}
                aria-label="Send message"
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-pill',
                  'transition-colors duration-150 motion-reduce:transition-none',
                  // An inset `ring-focus` on a primary-600 fill is the same
                  // colour as the fill (1.0:1). White reads on both stops.
                  'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white',
                  hasDraft
                    // `dark:text-primary-50` is the sanctioned label swap on a
                    // solid mid-scale fill: white on dark-mode primary-600 is
                    // 3.0:1, primary-50 on it is 5.6:1.
                    ? 'bg-primary-600 text-white shadow-soft hover:bg-primary-700 dark:text-primary-50'
                    : 'cursor-not-allowed border border-default bg-surface text-subtle',
                  isTyping && 'cursor-progress opacity-70',
                )}
              >
                {isTyping ? (
                  <Spinner size="sm" label={null} />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --------------------------------------- LAUNCHER + INVITATION NUDGE */}
      <div className="relative flex items-center">
        {!isOpen && !hasOpenedOnce && isPatientOrGuest && (
          <button
            type="button"
            onClick={open}
            className={cn(
              // Hidden on the narrowest phones, where a 16rem bubble beside a
              // 4rem launcher would push past the viewport edge.
              'absolute right-full mr-4 hidden w-max items-center gap-2 sm:flex',
              'animate-bounce rounded-card border border-default bg-surface px-4 py-2.5',
              'text-body-sm font-semibold text-default shadow-popover',
              'motion-reduce:animate-none',
              focusRing,
            )}
          >
            <Sparkles className="h-4 w-4 text-accent-700 dark:text-accent-400" aria-hidden="true" />
            Hi! I&apos;m your AI assistant
            <span
              className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 border-r border-t border-default bg-surface"
              aria-hidden="true"
            />
          </button>
        )}

        <button
          ref={launcherRef}
          type="button"
          onClick={() => (isOpen ? close() : open())}
          aria-label={isOpen ? 'Close AI assistant' : 'Open AI assistant'}
          aria-expanded={isOpen}
          aria-controls={mounted ? panelId : undefined}
          className={cn(
            'group relative flex h-14 w-14 items-center justify-center rounded-pill md:h-16 md:w-16',
            // THE one gradient in this widget. Light and dark resolve to the
            // same two physical colours (27 92 197 -> 15 110 86), both AA under
            // white, so the icon never dissolves in dark mode.
            'bg-gradient-to-r from-primary-600 to-accent-700 dark:from-primary-400 dark:to-accent-300',
            'text-white shadow-elevated',
            'transition-transform duration-300 ease-overshoot hover:scale-105',
            'motion-reduce:transition-none motion-reduce:hover:scale-100',
            isOpen && 'rotate-90 scale-95 motion-reduce:rotate-0',
            // An outside ring, offset against the canvas: an inset ring-focus
            // would be the same colour as the gradient's first stop.
            focusRing,
          )}
        >
          {isOpen ? (
            <X className="h-6 w-6" aria-hidden="true" />
          ) : (
            <>
              <PersonaIcon className="h-6 w-6" aria-hidden="true" />
              <span
                className={cn(
                  'absolute inset-0 scale-110 rounded-pill border-2 border-white/25 opacity-60',
                  'group-hover:animate-ping motion-reduce:group-hover:animate-none',
                )}
                aria-hidden="true"
              />
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default FloatingChatbot;
