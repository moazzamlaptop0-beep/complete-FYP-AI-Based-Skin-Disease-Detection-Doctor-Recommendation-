/**
 * cropImage — turn a react-image-crop selection into a real File.
 *
 * THE BUG THIS FIXES (src/components/ai-features/TryNowPage.jsx, lines 48 / 239-251)
 * ---------------------------------------------------------------------------
 * The old page seeded its crop state with a PERCENT crop —
 * `{unit:'%', width:50, height:50, x:25, y:25}` — and then cropped with
 *
 *     scaleX = img.naturalWidth / img.width;      // display -> natural pixels
 *     ctx.drawImage(img, crop.x * scaleX, crop.y * scaleY,
 *                        crop.width * scaleX, crop.height * scaleY, ...)
 *
 * That maths is only valid for a `px` crop. Applied to percent values it is
 * nonsense: on a 3000px-wide photo shown at 300px, scaleX is 10, so the
 * "centred 50%" selection (which should be a 1500x1500 box at 750,750) was
 * drawn as a 500x500 box at 250,250 — a sixth of the intended area, taken from
 * the top-left instead of the middle. The model was handed a smear of
 * background skin and the confidence came back near-random.
 *
 * It survived review because nobody reproduced it: `onChange={c => setCrop(c)}`
 * keeps react-image-crop's FIRST argument, which is a PIXEL crop, so the moment
 * a tester dragged a handle the state became pixels and the maths started
 * working. Only users who accepted the default crop untouched — most of them —
 * hit it.
 *
 * The fix is to stop trusting the unit and stop involving the DISPLAY size at
 * all. `toPixelCrop()` below takes the crop plus the image's
 * `naturalWidth`/`naturalHeight` and converts explicitly, so a `%` crop and a
 * `px` crop land on the same source rectangle. A crop whose unit is missing is
 * treated as PERCENT when every value is <= 100 (react-image-crop's own
 * default), because guessing "pixels" there is exactly how the bug comes back.
 *
 * OBJECT URL DISCIPLINE
 * ---------------------
 * Every `URL.createObjectURL` in here is paired with a `revokeObjectURL` in a
 * `finally`, and `revokePreview()` is exported for the callers that hold one in
 * state. An object URL pins the entire decoded bitmap in memory: on a phone,
 * twenty un-revoked 12-megapixel previews is an out-of-memory tab crash.
 */

/** Never hand the model an image larger than this on its long edge. */
export const MAX_OUTPUT_EDGE = 1600;
/** Below this a crop is almost certainly a mis-scaled selection, not a choice. */
export const MIN_OUTPUT_EDGE = 32;
export const DEFAULT_OUTPUT_TYPE = 'image/jpeg';
export const DEFAULT_OUTPUT_QUALITY = 0.92;

/**
 * Revoke a `blob:` URL. Safe to call with null, an https URL or a data URL —
 * callers should not have to remember which kind they are holding.
 * @param {string|null|undefined} url
 */
export function revokePreview(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* already revoked, or a browser that does not care */
  }
}

/**
 * Load a File/Blob (or a URL) into an `HTMLImageElement` with its natural
 * dimensions available. Revokes its own object URL on both paths.
 * @param {File|Blob|string} source
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const isUrl = typeof source === 'string';
    const url = isUrl ? source : URL.createObjectURL(source);
    const image = new Image();

    // Needed so a same-origin `/api/scans/<id>/image` can be re-cropped without
    // tainting the canvas. Harmless for blob: URLs.
    image.crossOrigin = 'anonymous';

    const done = (fn, value) => {
      if (!isUrl) revokePreview(url);
      fn(value);
    };

    image.onload = () => done(resolve, image);
    image.onerror = () =>
      done(reject, new Error('That file could not be read as an image. Try a different photo.'));
    image.src = url;
  });
}

/**
 * Convert ANY react-image-crop crop into integer source pixels.
 *
 * This is the whole fix. Do not "simplify" it by trusting `crop.unit`: an
 * untouched default crop arrives as percent, and drawing percent as pixels is
 * the 50x50-thumbnail bug.
 *
 * @param {{unit?:'%'|'px', x?:number, y?:number, width?:number, height?:number}} crop
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @returns {{x:number, y:number, width:number, height:number}} clamped to the image
 */
export function toPixelCrop(crop, naturalWidth, naturalHeight) {
  const full = { x: 0, y: 0, width: naturalWidth, height: naturalHeight };
  if (!crop || !naturalWidth || !naturalHeight) return full;

  const x = Number(crop.x) || 0;
  const y = Number(crop.y) || 0;
  const width = Number(crop.width) || 0;
  const height = Number(crop.height) || 0;
  if (width <= 0 || height <= 0) return full;

  // Explicit unit wins. Otherwise: everything within 0..100 on an image bigger
  // than 100px is overwhelmingly a percent crop, and treating it as pixels is
  // the failure mode we are fixing — so percent is the safe default.
  const looksPercent =
    crop.unit === '%'
    || (crop.unit !== 'px'
      && x <= 100 && y <= 100 && width <= 100 && height <= 100
      && (naturalWidth > 100 || naturalHeight > 100));

  const scaleX = looksPercent ? naturalWidth / 100 : 1;
  const scaleY = looksPercent ? naturalHeight / 100 : 1;

  let px = Math.round(x * scaleX);
  let py = Math.round(y * scaleY);
  let pw = Math.round(width * scaleX);
  let ph = Math.round(height * scaleY);

  // Clamp into the image. A crop dragged past the edge (or a rounding error at
  // 99.97%) must not produce a canvas with transparent bands down one side.
  px = Math.max(0, Math.min(px, naturalWidth - 1));
  py = Math.max(0, Math.min(py, naturalHeight - 1));
  pw = Math.max(1, Math.min(pw, naturalWidth - px));
  ph = Math.max(1, Math.min(ph, naturalHeight - py));

  return { x: px, y: py, width: pw, height: ph };
}

/** True when the crop is (within a pixel) the entire image — no work to do. */
export function isFullFrame(pixelCrop, naturalWidth, naturalHeight) {
  return (
    pixelCrop.x <= 1
    && pixelCrop.y <= 1
    && pixelCrop.width >= naturalWidth - 1
    && pixelCrop.height >= naturalHeight - 1
  );
}

/** `canvas.toBlob` as a promise, with a `toDataURL` fallback for old jsdom. */
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      try {
        const dataUrl = canvas.toDataURL(type, quality);
        const [meta, base64] = dataUrl.split(',');
        const mime = /:(.*?);/.exec(meta)?.[1] || type;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        resolve(new Blob([bytes], { type: mime }));
      } catch (error) {
        reject(error);
      }
      return;
    }
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the crop.'))),
      type,
      quality,
    );
  });
}

/** Keep the extension honest so the backend's allow-list sees what it expects. */
function withExtension(name, mimeType) {
  const base = String(name || 'scan').replace(/\.[^./\\]+$/, '') || 'scan';
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `${base}.${extension}`;
}

/**
 * Crop an image to a File.
 *
 * @param {object} options
 * @param {File|Blob|string} options.source       the original pick (or its URL)
 * @param {object} options.crop                   a react-image-crop crop, ANY unit
 * @param {HTMLImageElement} [options.imageElement] an already-loaded element, to
 *   avoid decoding the photo a second time
 * @param {string} [options.fileName]
 * @param {string} [options.type='image/jpeg']
 * @param {number} [options.quality=0.92]
 * @param {number} [options.maxEdge=1600]         downscale the long edge to this
 * @returns {Promise<{file:File, previewUrl:string, width:number, height:number}>}
 *   `previewUrl` is an object URL the CALLER now owns and must revoke.
 */
export async function cropImageToFile({
  source,
  crop,
  imageElement,
  fileName,
  type = DEFAULT_OUTPUT_TYPE,
  quality = DEFAULT_OUTPUT_QUALITY,
  maxEdge = MAX_OUTPUT_EDGE,
}) {
  const image = imageElement && imageElement.naturalWidth
    ? imageElement
    : await loadImageElement(source);

  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) {
    throw new Error('That image has no readable dimensions.');
  }

  // THE FIX: percent -> pixels, against the NATURAL size, every time.
  const pixelCrop = toPixelCrop(crop, naturalWidth, naturalHeight);

  if (pixelCrop.width < MIN_OUTPUT_EDGE || pixelCrop.height < MIN_OUTPUT_EDGE) {
    throw new Error('That selection is too small. Drag a larger area over the affected skin.');
  }

  // Downscale the long edge. 1600px is plenty for a 224px model input and keeps
  // the upload inside the 10MB limit without a second compression pass.
  const longEdge = Math.max(pixelCrop.width, pixelCrop.height);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const outputWidth = Math.max(1, Math.round(pixelCrop.width * scale));
  const outputHeight = Math.max(1, Math.round(pixelCrop.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot process images on a canvas.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  // JPEG has no alpha: without this, a PNG with transparency crops onto black.
  if (type !== 'image/png') {
    // A CSS keyword, not a token: this is canvas ink under a photograph, it is
    // never seen as a UI surface and must not follow the theme.
    context.fillStyle = 'white';
    context.fillRect(0, 0, outputWidth, outputHeight);
  }

  context.drawImage(
    image,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, // SOURCE, in real pixels
    0, 0, outputWidth, outputHeight, // DESTINATION
  );

  const blob = await canvasToBlob(canvas, type, quality);
  const name = withExtension(fileName || (source && source.name) || 'scan', type);
  const file = new File([blob], name, { type: blob.type || type, lastModified: Date.now() });

  return {
    file,
    previewUrl: URL.createObjectURL(file),
    width: outputWidth,
    height: outputHeight,
  };
}

/**
 * A centred crop covering `percent` of the shorter edge — what the cropper opens
 * with. Returned in PERCENT because that is what `<ReactCrop>` wants as its
 * controlled value; `cropImageToFile` converts it correctly either way.
 *
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @param {number} [percent=0.85]
 * @param {number|null} [aspect=null] e.g. 1 for a square
 */
export function centeredCrop(naturalWidth, naturalHeight, percent = 0.85, aspect = null) {
  if (!naturalWidth || !naturalHeight) {
    return { unit: '%', x: 5, y: 5, width: 90, height: 90 };
  }

  let widthPx = naturalWidth * percent;
  let heightPx = naturalHeight * percent;

  if (aspect) {
    if (widthPx / heightPx > aspect) widthPx = heightPx * aspect;
    else heightPx = widthPx / aspect;
  }

  return {
    unit: '%',
    width: (widthPx / naturalWidth) * 100,
    height: (heightPx / naturalHeight) * 100,
    x: ((naturalWidth - widthPx) / 2 / naturalWidth) * 100,
    y: ((naturalHeight - heightPx) / 2 / naturalHeight) * 100,
  };
}

/**
 * A small data: URL for the sessionStorage draft. Deliberately tiny — the draft
 * only needs a recognisable thumbnail, not the photo.
 * @param {File|Blob|string} source
 * @param {number} [maxEdge=320]
 * @returns {Promise<string|null>} null on any failure; a thumbnail is never
 *   important enough to fail a scan over.
 */
export async function makeThumbnailDataUrl(source, maxEdge = 320) {
  try {
    const image = await loadImageElement(source);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) return null;

    const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return null;
  }
}

export default cropImageToFile;
