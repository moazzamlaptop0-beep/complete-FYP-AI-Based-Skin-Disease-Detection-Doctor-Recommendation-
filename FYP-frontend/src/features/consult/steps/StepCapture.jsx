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
  Camera,
  Check,
  Crop as CropIcon,
  ImageUp,
  RefreshCw,
  RotateCcw,
  ScanLine,
  SwitchCamera,
  Upload,
  X,
} from 'lucide-react';

import { Alert, Button, Spinner, cn } from '../../../components/ui';
import { useConsult } from '../ConsultContext';
import { LIMITS } from '../consultReducer';
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

export default function StepCapture() {
  const { state, selectImage, setSensitive, analyze, clearImage } = useConsult();
  const { image, analysis } = state;

  const [mode, setMode] = useState(() => (image.file ? 'ready' : 'pick'));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // null | 'cropping' | 'compressing'
  const [dragging, setDragging] = useState(false);
  const [crop, setCrop] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [cameraError, setCameraError] = useState(null);

  const inputRef = useRef(null);
  const imgRef = useRef(null);
  const webcamRef = useRef(null);
  /** A source URL we created but have not yet handed to the reducer. */
  const orphanUrl = useRef(null);
  const mounted = useRef(true);

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

  // Keep the local mode honest when the reducer resets underneath us (the
  // ResetMenu on the result step can clear the image while we are unmounted).
  useEffect(() => {
    if (!image.file && !image.sourceUrl && mode === 'ready') setMode('pick');
  }, [image.file, image.sourceUrl, mode]);

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

  const isAnalysing = analysis.status === 'loading';

  return (
    <div className="space-y-5">
      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)} title="That photo will not work">
          {error}
        </Alert>
      )}

      {image.restored && !image.file && mode === 'pick' && (
        <Alert tone="info" title="Your draft is here, the photo is not">
          Browsers cannot keep a chosen file across a reload. Everything else you entered survived —
          just pick the photo again.
        </Alert>
      )}

      {/* ============================================================ PICK == */}
      {mode === 'pick' && (
        <>
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload a photo of the affected skin"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-card',
              'border-2 border-dashed p-8 text-center transition-colors sm:p-12',
              'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
              'focus-visible:ring-offset-canvas',
              dragging
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/40'
                : 'border-default bg-surface-sunken hover:border-primary-400',
            )}
          >
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-pill bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200"
            >
              <ImageUp className="h-6 w-6" />
            </span>
            <span className="text-label-lg text-default">
              {dragging ? 'Drop it here' : 'Drag a photo here, or tap to choose one'}
            </span>
            <span className="max-w-sm text-caption text-subtle">
              PNG, JPG or WebP, up to {prettyBytes(LIMITS.MAX_IMAGE_BYTES)}. Fill the frame with the
              spot, use daylight if you can, and hold the camera 10-15cm away.
            </span>
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

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => inputRef.current?.click()}
              leftIcon={<Upload aria-hidden="true" className="h-4 w-4" />}
              fullWidth
            >
              Choose a file
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setCameraError(null);
                setMode('camera');
              }}
              leftIcon={<Camera aria-hidden="true" className="h-4 w-4" />}
              fullWidth
            >
              Use the camera
            </Button>
          </div>
        </>
      )}

      {/* ========================================================== CAMERA == */}
      {mode === 'camera' && (
        <div className="space-y-3">
          {cameraError && (
            <Alert tone="warning" onDismiss={() => setCameraError(null)}>
              {cameraError}
            </Alert>
          )}

          <div className="relative overflow-hidden rounded-card border border-subtle bg-neutral-900">
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
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-body-sm text-muted">
            <CropIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
            Drag the box so it holds the affected skin and little else. The model looks at what is
            inside the box only.
          </p>

          <div className="flex justify-center overflow-hidden rounded-card border border-subtle bg-surface-sunken p-2">
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
        </div>
      )}

      {/* =========================================================== READY == */}
      {mode === 'ready' && image.previewUrl && (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="relative shrink-0 overflow-hidden rounded-card border border-subtle bg-surface-sunken">
              <img
                src={image.previewUrl}
                alt="The photo that will be analysed"
                className="h-48 w-full object-contain sm:h-40 sm:w-40 sm:object-cover"
              />
              {busy && (
                <span className="absolute inset-0 flex items-center justify-center bg-surface/70">
                  <Spinner />
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="truncate text-label-lg text-default">{image.name}</p>
                <p className="mt-0.5 text-caption text-subtle">
                  {image.width && image.height ? `${image.width}x${image.height} · ` : ''}
                  {prettyBytes(image.size)}
                  {image.source === 'camera' ? ' · taken with the camera' : ''}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isAnalysing}
                  onClick={() => setMode('crop')}
                  leftIcon={<CropIcon aria-hidden="true" className="h-4 w-4" />}
                >
                  Re-crop
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isAnalysing}
                  onClick={startOverPhoto}
                  leftIcon={<RefreshCw aria-hidden="true" className="h-4 w-4" />}
                >
                  Replace photo
                </Button>
              </div>
            </div>
          </div>

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

          <Button
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
