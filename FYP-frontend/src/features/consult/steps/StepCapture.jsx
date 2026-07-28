/**
 * StepCapture — get one good photograph, and nothing else.
 *
 * WHAT CHANGED
 * ------------
 * The old page did upload, camera, crop, compression, prediction, the symptom
 * modal AND the doctor picker in one 900-line component, with the crop bug
 * documented in ../lib/cropImage.js quietly ruining the input to the model.
 * Here the step does exactly one job and hands a clean File to the reducer.
 *
 * FOUR LOCAL MODES
 * ----------------
 *   'pick'   nothing chosen — dropzone + camera button
 *   'camera' react-webcam live, with a shutter
 *   'crop'   react-image-crop over the ORIGINAL pick
 *   'ready'  a cropped, compressed File is in state, waiting to be analysed
 *
 * THE SCANNING EXPERIENCE
 * -----------------------
 * Analysing used to change two pixels: a spinner inside the button. It now hands
 * the preview to <ScanningOverlay>, which frames the photo and narrates the
 * pipeline. The stages are driven from state that is REAL:
 *
 *   'prepare'  <- `busy`, i.e. the canvas crop and the browser-image-compression
 *                 pass, which genuinely run on this device
 *   'upload'   <- `analysis.status === 'loading'`, i.e. POST /predict in flight
 *   'model'    <- the same request, once the bytes have almost certainly landed
 *   'score'    <- owned by the RESULT step, where POST /api/triage-preview runs
 *
 * The one estimate is the upload -> model handover: a `fetch` cannot tell the
 * client when its last byte was sent, so a short timer decides WHICH truthful
 * description of one still-in-flight request to show. Nothing ever announces a
 * completion that has not happened, and the progress bar counts only stages that
 * have actually finished, so it cannot fill while anyone is still waiting.
 *
 * OBJECT URL OWNERSHIP
 * --------------------
 * This component creates the ORIGINAL's object URL and hands it to the reducer
 * as `image.sourceUrl` in the same dispatch. From then on ConsultContext owns
 * both URLs and revokes them when they change or the provider unmounts, so
 * "replace photo" pressed twenty times leaks nothing. The only URL this file
 * revokes itself is one it created and then failed to hand over.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import Webcam from 'react-webcam';
import imageCompression from 'browser-image-compression';
import {
  ArrowRight,
  Camera,
  Check,
  Crop as CropIcon,
  EyeOff,
  Focus,
  ImageUp,
  Lightbulb,
  RefreshCw,
  RotateCcw,
  Ruler,
  ScanLine,
  Sun,
  SwitchCamera,
  Upload,
  X,
} from 'lucide-react';

import { Alert, Badge, Button, cn } from '../../../components/ui';
import { useConsult } from '../ConsultContext';
import { LIMITS } from '../consultReducer';
import ScanningOverlay from '../components/ScanningOverlay';
import {
  centeredCrop,
  cropImageToFile,
  makeThumbnailDataUrl,
  revokePreview,
} from '../lib/cropImage';
import { ACCEPT_ATTRIBUTE, prettyBytes, validateImageFile } from '../lib/imageFile';

import SensitivityToggle from './SensitivityToggle';

/** Target after compression. Well under the backend's 10MB, plenty for a CNN. */
const COMPRESSION_OPTIONS = {
  maxSizeMB: 1.5,
  maxWidthOrHeight: 1600,
  useWebWorker: true,
  initialQuality: 0.9,
  fileType: 'image/jpeg',
};

/**
 * Presentation only: the advice panel shown beside the dropzone. The three
 * original sentences are unchanged — they are the ones that actually improve a
 * photograph — and each now carries the icon that makes the panel scannable.
 */
const PHOTO_TIPS = [
  { icon: Ruler, text: 'Fill the frame with the spot, about 10-15cm away.' },
  { icon: Sun, text: 'Use daylight or a bright room, and avoid harsh flash.' },
  { icon: Focus, text: 'Hold the phone steady so the photo comes out sharp.' },
];

/**
 * How long POST /predict is described as "Uploading securely" before the copy
 * moves on to "Running the model".
 *
 * This is the only inferred moment in the whole scanning sequence. `fetch` gives
 * no upload-progress events, so the alternative is to call several honest seconds
 * of model inference "uploading", which is the less true of the two options. The
 * request is genuinely still in flight either way.
 */
const UPLOAD_WINDOW_MS = 1400;

/**
 * The navbar's scan menu deep-links to `?capture=camera` / `?capture=upload`.
 *
 * AN INTENT IS SERVED ONCE, because re-reading the query string on every mount
 * reopened the live camera every time this step remounted: pressing "Replace
 * photo", or coming back from the result step, relaunched a camera nobody had
 * asked for. The URL ITSELF is the one-shot token — `history.replaceState`
 * strips `capture` the moment it is read, so a remount finds nothing and the
 * link a user bookmarks after arriving no longer carries a spent instruction.
 *
 * `servedIntent` is only the fallback for embedded webviews that refuse
 * replaceState. It deliberately does NOT latch when there was no intent to
 * serve: doing that broke the navbar's "Scan with camera" for anyone who had
 * already opened /consult once in the same page load, because the flag was
 * already spent by the time the deep link arrived.
 *
 * Read from window.location rather than useSearchParams on purpose: this step is
 * unit-tested without a Router, and a query string is not worth a router
 * dependency. Returns null outside the browser (SSR / non-DOM tests).
 */
let servedIntent = null;

function consumeCaptureIntent() {
  if (typeof window === 'undefined') return null;

  let intent = null;
  try {
    intent = new URLSearchParams(window.location.search).get('capture');
  } catch {
    return null;
  }

  // No instruction in the URL: nothing to serve, and nothing to remember.
  if (!intent) {
    servedIntent = null;
    return null;
  }

  // This exact instruction has already been served from a URL we could not
  // clean, so honouring it again would be the re-arming bug all over again.
  if (servedIntent === intent) return null;
  servedIntent = intent;

  try {
    const params = new URLSearchParams(window.location.search);
    params.delete('capture');
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
  } catch {
    // Some embedded webviews refuse replaceState. `servedIntent` above is what
    // keeps this a one-shot there.
  }
  return intent;
}

export default function StepCapture() {
  const { state, selectImage, setSensitive, analyze, clearImage } = useConsult();
  const { image, analysis } = state;

  // Read the deep link ONCE, in the initializer. Doing it in an effect (or on
  // every render) would drag the user back to the camera after they chose the
  // picker, because the query string never changes.
  const captureIntent = useRef(undefined);
  if (captureIntent.current === undefined) captureIntent.current = consumeCaptureIntent();

  const [mode, setMode] = useState(() => {
    if (image.file) return 'ready';
    return captureIntent.current === 'camera' ? 'camera' : 'pick';
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // null | 'cropping' | 'compressing'
  const [dragging, setDragging] = useState(false);
  const [crop, setCrop] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [cameraError, setCameraError] = useState(null);
  /** Which half of the in-flight /predict request the copy is describing. */
  const [serverStage, setServerStage] = useState('upload');

  const inputRef = useRef(null);
  const pickTileRef = useRef(null);
  const imgRef = useRef(null);
  const webcamRef = useRef(null);
  /** A source URL we created but have not yet handed to the reducer. */
  const orphanUrl = useRef(null);
  const mounted = useRef(true);

  const isAnalysing = analysis.status === 'loading';

  // Re-arming on mount is REQUIRED, not defensive. StrictMode mounts, unmounts
  // and remounts in development: the cleanup below sets the flag false, and
  // without restoring it here it stays false for the rest of the session.
  // Every `if (!mounted.current) return;` guard in the crop pipeline then fires
  // on the happy path -- the crop finishes, gets revoked and discarded, and the
  // button sits on "Cropping…" forever. useRef's initial value only applies to
  // the FIRST mount, which is why this read as correct.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Only ours. Anything already in `state.image` belongs to ConsultContext.
      revokePreview(orphanUrl.current);
      orphanUrl.current = null;
    };
  }, []);

  // `?capture=upload` means "I came here to upload": put the keyboard on the
  // file tile so the very next Enter opens the picker. Deliberately NOT calling
  // input.click() -- browsers only allow a file dialog from a fresh user
  // gesture, so a programmatic open here would be silently swallowed. One shot,
  // on mount, and only while nothing has been chosen yet.
  useEffect(() => {
    if (captureIntent.current !== 'upload') return;
    if (image.file || image.sourceUrl) return;
    pickTileRef.current?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the local mode honest when the reducer resets underneath us (the
  // ResetMenu on the result step can clear the image while we are unmounted).
  useEffect(() => {
    if (!image.file && !image.sourceUrl && mode === 'ready') setMode('pick');
  }, [image.file, image.sourceUrl, mode]);

  /**
   * Move the scanning copy from "Uploading securely" on to "Running the model".
   * Re-armed from scratch on every analyse, so a retry narrates itself again
   * instead of opening on the later stage.
   */
  useEffect(() => {
    if (!isAnalysing) {
      setServerStage('upload');
      return undefined;
    }
    setServerStage('upload');
    const timer = setTimeout(() => setServerStage('model'), UPLOAD_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [isAnalysing]);

  // ------------------------------------------------------------ picking ----
  /**
   * Accept a File from the dropzone, the picker or the webcam, and open the
   * cropper on it. The ORIGINAL is what goes into state as `sourceFile` — the
   * crop is redone from it, never from a previous crop, so re-cropping never
   * compounds JPEG artefacts.
   */
  const acceptFile = useCallback(
    (file, source) => {
      const problem = validateImageFile(file);
      if (problem) {
        setError(problem);
        return;
      }

      setError(null);
      setCrop(null);

      const url = URL.createObjectURL(file);
      orphanUrl.current = url;

      // Dispatch WITHOUT a `file`: nothing is analysable until it is cropped.
      // The reducer's IMAGE_SELECTED also wipes any previous verdict for us.
      selectImage({
        file: null,
        previewUrl: null,
        sourceFile: file,
        sourceUrl: url,
        source,
      });

      // The reducer now owns it; our cleanup must not revoke it.
      orphanUrl.current = null;
      setMode('crop');
    },
    [selectImage],
  );

  const onInputChange = useCallback(
    (event) => {
      const file = event.target.files?.[0];
      // Reset so re-picking the SAME file still fires a change event.
      event.target.value = '';
      if (file) acceptFile(file, 'file');
    },
    [acceptFile],
  );

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) acceptFile(file, 'file');
    },
    [acceptFile],
  );

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  // ------------------------------------------------------------- camera ----
  const capture = useCallback(async () => {
    const shot = webcamRef.current?.getScreenshot?.();
    if (!shot) {
      setCameraError('The camera did not return a frame. Try again, or upload a photo instead.');
      return;
    }
    try {
      const blob = await (await fetch(shot)).blob();
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      acceptFile(file, 'camera');
    } catch {
      setCameraError('Could not save that frame. Try again, or upload a photo instead.');
    }
  }, [acceptFile]);

  // --------------------------------------------------------------- crop ----
  const onCropImageLoad = useCallback((event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    // A generous, centred default. Because cropImageToFile converts percent
    // against the NATURAL size, accepting this untouched now produces exactly
    // what it looks like — which is precisely what the old page got wrong.
    setCrop(centeredCrop(naturalWidth, naturalHeight, 0.85));
  }, []);

  const confirmCrop = useCallback(async () => {
    if (!image.sourceFile && !image.sourceUrl) {
      setError('The original photo is no longer available. Pick it again.');
      setMode('pick');
      return;
    }

    setError(null);
    setBusy('cropping');

    let cropped = null;
    try {
      cropped = await cropImageToFile({
        source: image.sourceFile || image.sourceUrl,
        imageElement: imgRef.current,
        // `crop` is the PERCENT crop react-image-crop hands us as its second
        // argument. toPixelCrop() converts it; never pass the first argument.
        crop,
        fileName: image.sourceFile?.name || image.name || 'scan.jpg',
      });

      if (!mounted.current) {
        revokePreview(cropped.previewUrl);
        return;
      }

      setBusy('compressing');
      let finalFile = cropped.file;
      try {
        const compressed = await imageCompression(cropped.file, COMPRESSION_OPTIONS);
        // Only take it if it actually helped — the library can grow a small file.
        if (compressed && compressed.size > 0 && compressed.size < cropped.file.size) {
          finalFile = new File([compressed], cropped.file.name, {
            type: compressed.type || 'image/jpeg',
            lastModified: Date.now(),
          });
        }
      } catch {
        // Compression is an optimisation. A crop that is already under 10MB is
        // perfectly uploadable, so a worker failure must not lose the photo.
      }

      if (!mounted.current) {
        revokePreview(cropped.previewUrl);
        return;
      }

      const dataUrl = await makeThumbnailDataUrl(finalFile);
      if (!mounted.current) {
        revokePreview(cropped.previewUrl);
        return;
      }

      selectImage({
        file: finalFile,
        previewUrl: cropped.previewUrl,
        // Pass the original through UNCHANGED so ConsultContext sees the same
        // sourceUrl on both sides of the diff and does not revoke it — we still
        // need it to re-crop.
        sourceFile: image.sourceFile,
        sourceUrl: image.sourceUrl,
        width: cropped.width,
        height: cropped.height,
        source: image.source || 'file',
        dataUrl,
      });
      setMode('ready');
    } catch (caught) {
      if (cropped) revokePreview(cropped.previewUrl);
      if (mounted.current) setError(caught?.message || 'Could not crop that image.');
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [crop, image.sourceFile, image.sourceUrl, image.name, image.source, selectImage]);

  const startOverPhoto = useCallback(() => {
    setError(null);
    setCrop(null);
    setMode('pick');
    clearImage();
  }, [clearImage]);

  // =========================================================================
  // RENDER
  // =========================================================================

  /** The facts about the file, as a clinical review reads them. */
  const fileFacts = [
    {
      label: 'Dimensions',
      value: image.width && image.height ? `${image.width}x${image.height} px` : 'Not reported',
    },
    { label: 'File size', value: prettyBytes(image.size) || 'Not reported' },
    {
      label: 'Source',
      value: image.source === 'camera' ? 'Taken with the camera' : 'Chosen from this device',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)} title="That photo will not work">
          {error}
        </Alert>
      )}

      {image.restored && !image.file && mode === 'pick' && (
        <Alert tone="info" title="Your draft is here, the photo is not">
          Browsers cannot keep a chosen file across a reload. Everything else you entered survived,
          so just pick the photo again.
        </Alert>
      )}

      {/* ============================================================ PICK == */}
      {mode === 'pick' && (
        <>
          <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.4fr)_minmax(15rem,1fr)] 2xl:items-start">
            <div className="flex min-w-0 flex-col gap-3.5">
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload a photo of the affected skin"
                onClick={openPicker}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openPicker();
                  }
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  'relative flex min-h-[15rem] cursor-pointer flex-col items-center justify-center',
                  'gap-3 overflow-hidden rounded-card border-2 border-dashed p-6 text-center sm:min-h-[17rem] sm:p-10',
                  'transition-[background-color,border-color,box-shadow] duration-200 ease-emphasized',
                  'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                  'focus-visible:ring-offset-canvas',
                  dragging
                    ? 'border-primary-500 bg-gradient-to-br from-primary-100 via-surface to-accent-100 shadow-card'
                    : cn(
                        'border-strong bg-surface-sunken hover:border-primary-400',
                        'hover:bg-gradient-to-br hover:from-primary-50 hover:via-surface hover:to-accent-50',
                      ),
                )}
              >
                {/* Everything inside is inert: a child that can be the target of
                    a drag event fires `dragleave` on this container the moment
                    the pointer crosses it, which made the drag-over state
                    flicker on and off as you moved across the label. */}
                <div className="pointer-events-none flex flex-col items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid h-16 w-16 place-items-center rounded-pill text-white shadow-card',
                      'bg-gradient-to-br from-primary-600 to-accent-700',
                      'dark:from-primary-400 dark:to-accent-300',
                      'transition-transform duration-200 ease-overshoot motion-reduce:transition-none',
                      dragging && 'scale-110 motion-reduce:scale-100',
                    )}
                  >
                    <ImageUp className="h-7 w-7" />
                  </span>

                  <span className="font-heading text-heading-md text-default">
                    {dragging ? 'Drop it here' : 'Drag and drop a photo here'}
                  </span>
                  <span className="text-body-sm text-muted">or tap to browse your device</span>
                  <span className="max-w-sm text-caption text-subtle">
                    PNG, JPG or WebP, up to {prettyBytes(LIMITS.MAX_IMAGE_BYTES)}. One clear photo of
                    the affected skin is all we need.
                  </span>
                </div>
              </div>

              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                onChange={onInputChange}
                className="ui-sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />

              {/* Two clear ways in: the picker and the camera, as tappable cards. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  ref={pickTileRef}
                  type="button"
                  onClick={openPicker}
                  className={cn(
                    'group flex items-center gap-3.5 rounded-card border border-subtle bg-surface p-4 text-left',
                    'shadow-soft transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card',
                    'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                    'focus-visible:ring-offset-surface',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-field bg-info-100 text-info-700"
                  >
                    <Upload className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-label-lg text-default">Choose a file</span>
                    <span className="mt-0.5 block text-caption text-subtle">
                      Pick a photo from your gallery or computer.
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCameraError(null);
                    setMode('camera');
                  }}
                  className={cn(
                    'group flex items-center gap-3.5 rounded-card border border-subtle bg-surface p-4 text-left',
                    'shadow-soft transition hover:-translate-y-0.5 hover:border-accent-300 hover:shadow-card',
                    'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                    'focus-visible:ring-offset-surface',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-field bg-accent-100 text-accent-700"
                  >
                    <Camera className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-label-lg text-default">Use the camera</span>
                    <span className="mt-0.5 block text-caption text-subtle">
                      Take a close-up right now, with a framing guide.
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  />
                </button>
              </div>
            </div>

            {/* The advice, as a panel that sits beside the dropzone on a wide
                screen and slots underneath it everywhere else. */}
            <aside className="rounded-card border border-subtle bg-surface p-4 shadow-soft">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-warning-100 text-warning-700"
                >
                  <Lightbulb className="h-4 w-4" />
                </span>
                <h3 className="text-label-lg text-default">A photo the model can read</h3>
              </div>

              <ul className="mt-3 space-y-3">
                {PHOTO_TIPS.map((tip) => {
                  const TipIcon = tip.icon;
                  return (
                    <li key={tip.text} className="flex items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-field bg-surface-sunken text-accent-700 dark:text-accent-400"
                      >
                        <TipIcon className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-body-sm text-muted">{tip.text}</span>
                    </li>
                  );
                })}
              </ul>

              <p className="mt-3.5 border-t border-subtle pt-3 text-caption text-subtle">
                You crop the photo yourself on the next screen, so a little extra room around the
                spot is fine.
              </p>
            </aside>
          </div>

          {/* Privacy, in one calm block below the actions. */}
          <SensitivityToggle
            value={image.isSensitive}
            disabled={isAnalysing}
            onChange={setSensitive}
          />
        </>
      )}

      {/* ========================================================== CAMERA == */}
      {mode === 'camera' && (
        <div className="flex flex-col gap-3">
          {cameraError && (
            <Alert tone="warning" onDismiss={() => setCameraError(null)}>
              {cameraError}
            </Alert>
          )}

          {/* Fixed navy, not a flipping scale: a camera surface should stay
              dark in BOTH themes, and stock neutral-900 turns light in dark mode. */}
          <div className="relative overflow-hidden rounded-card border border-subtle bg-navy-950 shadow-card">
            <Webcam
              ref={webcamRef}
              audio={false}
              screenshotFormat="image/jpeg"
              screenshotQuality={0.95}
              videoConstraints={{ facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }}
              onUserMediaError={() =>
                setCameraError(
                  'No camera available, or permission was refused. You can upload a photo instead.',
                )
              }
              className="block max-h-[60vh] w-full object-contain"
            />
            {/* A framing guide, so people centre the lesion instead of their arm. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <span className="h-2/3 w-2/3 max-w-xs rounded-card border-2 border-dashed border-white/70" />
            </div>
            <p
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950 to-transparent p-3 text-center text-caption text-white/80"
            >
              Centre the spot inside the box, then take the photo.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={capture}
              leftIcon={<ScanLine aria-hidden="true" className="h-4 w-4" />}
              fullWidth
            >
              Take the photo
            </Button>
            <Button
              variant="outline"
              onClick={() => setFacingMode((value) => (value === 'environment' ? 'user' : 'environment'))}
              leftIcon={<SwitchCamera aria-hidden="true" className="h-4 w-4" />}
              fullWidth
            >
              Flip camera
            </Button>
            <Button
              variant="ghost"
              onClick={() => setMode('pick')}
              leftIcon={<X aria-hidden="true" className="h-4 w-4" />}
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ============================================================ CROP == */}
      {mode === 'crop' && image.sourceUrl && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3 rounded-field border border-default bg-surface-sunken p-3">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-accent-100 text-accent-700"
            >
              <CropIcon className="h-4 w-4" />
            </span>
            <p className="text-body-sm text-muted">
              Drag the box so it holds the affected skin and little else. The model looks at what is
              inside the box only.
            </p>
          </div>

          <div className="flex justify-center overflow-hidden rounded-card border border-default bg-surface-sunken p-2">
            <ReactCrop
              crop={crop ?? undefined}
              /* SECOND argument = the PERCENT crop. Keeping this one (and
                 converting it against naturalWidth/Height in cropImageToFile)
                 is the whole fix for the old mis-scaled crop. */
              onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
              minWidth={24}
              minHeight={24}
              keepSelection
              ruleOfThirds
            >
              <img
                ref={imgRef}
                src={image.sourceUrl}
                alt="Position the crop box over the affected skin"
                onLoad={onCropImageLoad}
                className="max-h-[55vh] w-auto"
              />
            </ReactCrop>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={confirmCrop}
              loading={busy !== null}
              loadingText={busy === 'compressing' ? 'Compressing…' : 'Cropping…'}
              leftIcon={<Check aria-hidden="true" className="h-4 w-4" />}
              fullWidth
            >
              Use this crop
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                const element = imgRef.current;
                if (element) {
                  setCrop(centeredCrop(element.naturalWidth, element.naturalHeight, 1));
                }
              }}
              leftIcon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
              fullWidth
            >
              Use the whole photo
            </Button>
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={startOverPhoto}
              leftIcon={<X aria-hidden="true" className="h-4 w-4" />}
              fullWidth
            >
              Pick another
            </Button>
          </div>

          {/* The crop and the compression pass are real work on this device, so
              they get the same staged narration the upload does. Rendered BELOW
              the buttons so appearing cannot shove them out from under a finger,
              and the cropper stays mounted above: `cropImageToFile` is reading
              that <img> element. */}
          {busy && (
            <ScanningOverlay
              stage="prepare"
              title="Preparing your photo"
              note="This all happens on your device. Nothing has been uploaded yet."
            />
          )}
        </div>
      )}

      {/* =========================================================== READY == */}
      {mode === 'ready' && image.previewUrl && (
        <div className="flex flex-col gap-4">
          {isAnalysing ? (
            /* The preview becomes the scanning surface. Same photo, same frame,
               so the transition reads as the model arriving at the image rather
               than the page swapping out from under the patient. */
            <ScanningOverlay
              src={image.previewUrl}
              alt="The photo being analysed"
              stage={serverStage}
              note="The crop is with our server so the model can read it. No doctor sees it until you pick one."
            />
          ) : (
            /* The clinical review: the photo, then the facts about it. */
            <div className="overflow-hidden rounded-card border border-subtle bg-surface shadow-card">
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:gap-5 sm:p-5">
                <div className="relative shrink-0 overflow-hidden rounded-field border border-default bg-surface-sunken">
                  <img
                    src={image.previewUrl}
                    alt="The photo that will be analysed"
                    className="h-48 w-full object-contain sm:h-44 sm:w-44 sm:object-cover"
                  />
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="flex items-center gap-1.5 text-overline uppercase text-accent-700 dark:text-accent-400">
                    <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                    Ready to analyse
                  </p>
                  <p className="mt-1.5 truncate font-heading text-heading-sm text-default">
                    {image.name}
                  </p>

                  <dl className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {fileFacts.map((fact) => (
                      <div key={fact.label} className="min-w-0">
                        <dt className="text-caption text-subtle">{fact.label}</dt>
                        <dd className="truncate text-label-md text-default">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {image.isSensitive ? (
                      <Badge
                        tone="accent"
                        size="sm"
                        icon={<EyeOff aria-hidden="true" className="h-3 w-3" />}
                      >
                        Marked sensitive
                      </Badge>
                    ) : (
                      <Badge tone="neutral" size="sm">
                        Not marked sensitive
                      </Badge>
                    )}
                  </div>

                  {/* Adjusting the photo belongs WITH the photo, not down beside
                      the primary action, so the two are never confused for the
                      same kind of decision. */}
                  <div className="mt-auto flex flex-wrap gap-2 pt-3.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setMode('crop')}
                      leftIcon={<CropIcon aria-hidden="true" className="h-3.5 w-3.5" />}
                    >
                      Re-crop
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={startOverPhoto}
                      leftIcon={<RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />}
                    >
                      Replace photo
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <SensitivityToggle
            value={image.isSensitive}
            disabled={isAnalysing}
            onChange={setSensitive}
          />

          {analysis.status === 'error' && (
            <Alert tone="danger" title="The analysis failed">
              {analysis.error}
            </Alert>
          )}

          {/* The one decision on this screen. Re-crop and Replace sit up in the
              review card with the photo they act on. */}
          <Button
            variant="gradient"
            onClick={() => analyze()}
            loading={isAnalysing}
            loadingText="Analysing…"
            leftIcon={<ScanLine aria-hidden="true" className="h-4 w-4" />}
            size="lg"
            fullWidth
          >
            Analyse this photo
          </Button>

          <p className="text-center text-caption text-subtle">
            Nothing is sent to a doctor by analysing. You choose who sees it two steps from now.
          </p>
        </div>
      )}
    </div>
  );
}
