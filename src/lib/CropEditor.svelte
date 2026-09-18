<script>
  import Cropper from 'cropperjs';
  import 'cropperjs/dist/cropper.css';
  import PassportGuide from './PassportGuide.svelte';

  export let src = '';
  export let aspectRatio = 35 / 45;
  export let showGuide = false;
  export let onCropChange = () => {};
  export let onCropPending = () => {};

  let cropper;
  let normalizedImage;
  let ready = false;
  let error = '';
  let exportTimer;
  let lastGeometry = '';
  let guideBox = null;

  function updateGuideBox() {
    if (ready && cropper) {
      const box = cropper.getCropBoxData();
      guideBox = { left: box.left, top: box.top, width: box.width, height: box.height };
    }
  }

  function scheduleExport() {
    clearTimeout(exportTimer);
    updateGuideBox();
    onCropPending(true);
    exportTimer = setTimeout(exportCrop, 100);
  }

  function exportCrop() {
    if (!ready || !cropper) {
      onCropPending(false);
      return;
    }
    const data = cropper.getData();
    if (!(data.width > 0 && data.height > 0)) {
      onCropPending(false);
      return;
    }

    // Cropper may report an identical crop after a viewport resize. Avoid
    // recreating the print sheet (and triggering another layout) in that case.
    const geometry = ['x', 'y', 'width', 'height', 'rotate', 'scaleX', 'scaleY']
      .map((key) => Number(data[key] ?? 0).toFixed(3))
      .join(':');
    if (geometry === lastGeometry) {
      onCropPending(false);
      return;
    }

    try {
      const canvas = drawCrop(data);
      if (!canvas || !canvas.width || !canvas.height) {
        throw new Error('The cropped image is empty.');
      }
      lastGeometry = geometry;
      error = '';
      onCropChange({ canvas, width: data.width, height: data.height });
    } catch {
      error = 'This crop could not be prepared. Try a smaller photo or select the photo again.';
    } finally {
      onCropPending(false);
    }
  }

  function drawCrop(data) {
    if (!normalizedImage) throw new Error('The source image is not ready.');
    const image = cropper.getImageData();
    const bounds = cropper.getCanvasData();
    const scale = Math.min(1, 2400 / Math.max(data.width, data.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(data.width * scale));
    canvas.height = Math.max(1, Math.round(data.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    // Cropper 1.x's maxWidth/maxHeight export downsamples the full image
    // before cropping. Draw directly into the bounded crop instead, retaining
    // the original detail even when selecting a small face in a large photo.
    // Its displayed image has already had EXIF orientation normalized.
    context.scale(canvas.width / data.width, canvas.height / data.height);
    context.translate(-data.x, -data.y);
    context.translate(bounds.naturalWidth / 2, bounds.naturalHeight / 2);
    context.rotate((image.rotate || 0) * Math.PI / 180);
    context.scale(image.scaleX ?? 1, image.scaleY ?? 1);
    context.drawImage(normalizedImage, -image.naturalWidth / 2, -image.naturalHeight / 2, image.naturalWidth, image.naturalHeight);
    return canvas;
  }

  function validRatio(value) {
    return Number.isFinite(value) && value > 0 ? value : 35 / 45;
  }

  // The action owns the image source and Cropper lifetime. Parent updates to
  // the output canvas do not replace the cropper or reset the current crop.
  function mountCropper(node, initial) {
    let currentSource;
    let currentRatio;
    let generation = 0;
    const viewport = node.parentElement;
    let viewportWidth = viewport.offsetWidth;
    let viewportHeight = viewport.offsetHeight;

    const resizeObserver = new ResizeObserver(() => {
      const width = viewport.offsetWidth;
      const height = viewport.offsetHeight;
      if (!width || !height || (width === viewportWidth && height === viewportHeight)) return;
      viewportWidth = width;
      viewportHeight = height;
      if (!ready || !cropper) return;

      // Restore natural image coordinates, not viewport-scaled coordinates.
      // This also keeps the guide attached when the screen changes shape.
      const data = cropper.getData();
      if (!(data.width > 0 && data.height > 0)) return;
      cropper.resize();
      const container = cropper.getContainerData();
      const scale = Math.min(container.width / data.width, container.height / data.height) * 0.82;
      cropper.clear();
      cropper.zoomTo(scale);
      cropper.setCanvasData({
        left: (container.width - data.width * scale) / 2 - data.x * scale,
        top: (container.height - data.height * scale) / 2 - data.y * scale,
      });
      cropper.crop();
      cropper.setData(data);
      scheduleExport();
    });
    resizeObserver.observe(viewport);

    function update({ src: nextSource, aspectRatio: nextRatio }) {
      const ratio = validRatio(nextRatio);
      if (currentSource === nextSource) {
        if (currentRatio !== ratio) {
          currentRatio = ratio;
          cropper?.setAspectRatio(ratio);
          scheduleExport();
        }
        return;
      }

      const activeGeneration = ++generation;
      clearTimeout(exportTimer);
      onCropPending(false);
      ready = false;
      error = '';
      lastGeometry = '';
      guideBox = null;
      cropper?.destroy();
      cropper = undefined;
      normalizedImage = undefined;
      currentSource = nextSource;
      currentRatio = ratio;
      if (!nextSource) return;
      node.src = nextSource;

      cropper = new Cropper(node, {
        aspectRatio: ratio,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 0.82,
        background: false,
        modal: true,
        highlight: false,
        center: true,
        guides: true,
        responsive: false,
        restore: true,
        checkCrossOrigin: false,
        checkOrientation: true,
        minContainerWidth: 0,
        minContainerHeight: 0,
        minCropBoxWidth: 24,
        minCropBoxHeight: 24,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        wheelZoomRatio: 0.05,
        ready() {
          if (generation !== activeGeneration) return;
          normalizedImage = node.parentElement?.querySelector('.cropper-canvas img');
          ready = true;
          scheduleExport();
        },
        crop: scheduleExport,
        cropend: scheduleExport,
        zoom: scheduleExport,
      });
    }

    function imageError() {
      clearTimeout(exportTimer);
      ready = false;
      error = 'This photo could not be opened. Select a JPEG, PNG, or another supported image.';
      onCropPending(false);
    }

    node.addEventListener('error', imageError);
    update(initial);
    return {
      update,
      destroy() {
        generation += 1;
        resizeObserver.disconnect();
        clearTimeout(exportTimer);
        onCropPending(false);
        node.removeEventListener('error', imageError);
        cropper?.destroy();
        cropper = undefined;
        normalizedImage = undefined;
      },
    };
  }

  function moveCrop(x, y) {
    if (!ready) return;
    const box = cropper.getCropBoxData();
    cropper.setCropBoxData({ left: box.left + x, top: box.top + y });
    scheduleExport();
  }

  function resizeCrop(factor) {
    if (!ready) return;
    const box = cropper.getCropBoxData();
    const width = box.width * factor;
    const height = box.height * factor;
    cropper.setCropBoxData({
      width,
      height,
      left: box.left + (box.width - width) / 2,
      top: box.top + (box.height - height) / 2,
    });
    scheduleExport();
  }

  function zoom(amount) {
    if (!ready) return;
    cropper.zoom(amount);
    scheduleExport();
  }

  function rotate(degrees) {
    if (!ready) return;
    cropper.rotate(degrees);
    scheduleExport();
  }

  function reset() {
    if (!ready) return;
    cropper.reset();
    cropper.setAspectRatio(validRatio(aspectRatio));
    scheduleExport();
  }
</script>

<div class="crop-editor" class:with-passport-guide={showGuide}>
  <div class="crop-viewport" aria-busy={!ready && !error}>
    <img use:mountCropper={{ src, aspectRatio }} alt="Selected for cropping" draggable="false" />
    {#if showGuide && ready && guideBox}
      <PassportGuide style={`left:${guideBox.left}px;top:${guideBox.top}px;width:${guideBox.width}px;height:${guideBox.height}px`} />
    {/if}
    {#if !ready && !error}
      <div class="viewport-status" role="status">Opening photo…</div>
    {/if}
    {#if error}
      <div class="viewport-status crop-error" role="alert">{error}</div>
    {/if}
  </div>

  <div class="crop-toolbar" role="group" aria-label="Crop controls">
    <div class="button-group" role="group" aria-label="Zoom photo">
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={!ready} onclick={() => zoom(-0.1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5" /><path d="m15 15 5 5M7 10h6" /></svg>
      </button>
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={!ready} onclick={() => zoom(0.1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5" /><path d="m15 15 5 5M7 10h6M10 7v6" /></svg>
      </button>
    </div>
    <div class="button-group" role="group" aria-label="Rotate photo">
      <button type="button" aria-label="Rotate left 90 degrees" title="Rotate left 90°" disabled={!ready} onclick={() => rotate(-90)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1.5 8M4 4v6h6" /><path d="M10 10h6v6h-6z" /></svg>
      </button>
      <button type="button" aria-label="Rotate right 90 degrees" title="Rotate right 90°" disabled={!ready} onclick={() => rotate(90)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10a8 8 0 1 0-1.5 8M20 4v6h-6" /><path d="M8 10h6v6H8z" /></svg>
      </button>
    </div>
    <div class="button-group" role="group" aria-label="Resize crop">
      <button type="button" aria-label="Make crop smaller" title="Make crop smaller" disabled={!ready} onclick={() => resizeCrop(0.9)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 5 5M4 9h5V4m11 16-5-5m5 0h-5v5" /></svg>
      </button>
      <button type="button" aria-label="Make crop larger" title="Make crop larger" disabled={!ready} onclick={() => resizeCrop(1.1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 9-5-5m0 5V4h5m6 11 5 5m0-5v5h-5" /></svg>
      </button>
    </div>
    <button class="reset-button" type="button" disabled={!ready} onclick={reset}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1.5 8M4 4v6h6" /></svg>
      Reset
    </button>
  </div>

  <div class="crop-footer">
    <p>Drag the frame or its corners to crop. Scroll or pinch to zoom.</p>
    <div class="move-controls" role="group" aria-label="Move crop">
      <span>Move crop</span>
      <button type="button" aria-label="Move crop left" title="Move crop left" disabled={!ready} onclick={() => moveCrop(-8, 0)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12" /></svg>
      </button>
      <button type="button" aria-label="Move crop up" title="Move crop up" disabled={!ready} onclick={() => moveCrop(0, -8)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6M12 8v12" /></svg>
      </button>
      <button type="button" aria-label="Move crop down" title="Move crop down" disabled={!ready} onclick={() => moveCrop(0, 8)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6M12 4v12" /></svg>
      </button>
      <button type="button" aria-label="Move crop right" title="Move crop right" disabled={!ready} onclick={() => moveCrop(8, 0)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6M4 12h12" /></svg>
      </button>
    </div>
  </div>
</div>

<style>
  .crop-editor { min-width: 0; }
  .crop-viewport {
    position: relative;
    width: 100%;
    min-width: 0;
    height: clamp(300px, 44vw, 460px);
    overflow: hidden;
    border: 1px solid var(--border, #35383f);
    border-radius: 12px;
    background: #111216;
  }
  .crop-viewport > img { display: block; max-width: 100%; max-height: 100%; }
  .with-passport-guide :global(.cropper-dashed), .with-passport-guide :global(.cropper-center) { visibility: hidden; }
  .viewport-status {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    padding: 28px;
    background: #111216;
    color: var(--muted, #9ba1ad);
    font-size: 0.875rem;
    text-align: center;
  }
  .crop-error { color: #ffb4ab; }
  .crop-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 12px 12px 0;
  }
  .button-group { display: flex; gap: 2px; }
  button {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--text, #e5e7eb);
    cursor: pointer;
    font: inherit;
  }
  button:hover:not(:disabled) { background: #a9c7ff14; color: var(--accent, #a9c7ff); }
  button:focus-visible { outline: 2px solid var(--accent, #a9c7ff); outline-offset: 2px; }
  button:disabled { opacity: 0.38; cursor: default; }
  button svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; }
  .button-group + .button-group { border-left: 1px solid var(--border, #35383f); padding-left: 10px; }
  .reset-button { gap: 7px; width: auto; padding: 0 10px; margin-left: auto; color: var(--accent, #a9c7ff); font-size: 0.875rem; }
  .crop-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 16px; padding: 8px 12px 12px; }
  .crop-footer p { flex: 1 1 220px; margin: 0; color: var(--muted, #9ba1ad); font-size: 0.78rem; line-height: 1.55; }
  .move-controls { display: flex; align-items: center; gap: 1px; }
  .move-controls span { color: var(--muted, #9ba1ad); font-size: 0.75rem; margin-right: 5px; }
  .move-controls button { width: 34px; height: 34px; }
  .move-controls svg { width: 17px; height: 17px; }
  .crop-viewport :global(.cropper-container) { font-family: inherit; }
  .crop-viewport :global(.cropper-modal) { opacity: 0.62; }
  .crop-viewport :global(.cropper-view-box) { outline: 1px solid var(--accent, #a9c7ff); outline-color: var(--accent, #a9c7ff); }
  .crop-viewport :global(.cropper-line), .crop-viewport :global(.cropper-point) { background: var(--accent, #a9c7ff); }
  .crop-viewport :global(.cropper-point) { width: 8px; height: 8px; opacity: 1; border-radius: 1px; }
  .crop-viewport :global(.cropper-point.point-e) { right: -4px; }
  .crop-viewport :global(.cropper-point.point-n) { top: -4px; }
  .crop-viewport :global(.cropper-point.point-w) { left: -4px; }
  .crop-viewport :global(.cropper-point.point-s) { bottom: -4px; }
  .crop-viewport :global(.cropper-point.point-ne) { top: -4px; right: -4px; }
  .crop-viewport :global(.cropper-point.point-nw) { top: -4px; left: -4px; }
  .crop-viewport :global(.cropper-point.point-sw) { bottom: -4px; left: -4px; }
  .crop-viewport :global(.cropper-point.point-se) { bottom: -4px; right: -4px; }
  @media (max-width: 420px) {
    .crop-viewport { height: 340px; }
    .crop-toolbar { gap: 4px; }
    .button-group + .button-group { padding-left: 4px; }
    .crop-toolbar button { width: 35px; height: 38px; }
    .crop-toolbar .reset-button { width: auto; padding: 0 6px; }
  }
</style>
