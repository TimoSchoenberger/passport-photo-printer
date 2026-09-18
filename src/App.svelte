<script>
  import { onMount, tick } from 'svelte';
  import Icon from './lib/Icon.svelte';
  import CropEditor from './lib/CropEditor.svelte';
  import CameraCapture from './lib/CameraCapture.svelte';
  import { calculateLayout, renderSheet, canvasToJpeg, downloadBlob, downloadPdf } from './lib/print.js';

  let fileInput;
  let cameraDialog;
  let cameraOpen = false;
  let cameraSupported = false;
  let sourceUrl = '';
  let sourceName = '';
  let originalWidth = 0;
  let originalHeight = 0;
  let crop = null;
  let cropPending = false;
  let loading = false;
  let loadMessage = '';
  let dragOver = false;
  let dragDepth = 0;
  let fileVersion = 0;
  let photoPreset = '35x45';
  let photoWidth = 35;
  let photoHeight = 45;
  let paperPreset = '10x15';
  let copies = 8;
  let gap = 2;
  let margin = 2;
  let cutMarks = true;
  let showGuide = false;
  let layout;
  let sheetCanvas = null;
  let sheetUrl = '';
  let outputError = '';
  let notice = '';
  let noticeKind = 'success';
  let busy = '';
  let config = { immichConfigured: false, maxUploadBytes: 20 * 1024 * 1024 };
  let configLoaded = false;
  let configError = '';
  let settingsDialog;
  let saveTarget = 'sheet';
  let savedUrl = '';
  let previewFrame;

  $: paperWidth = paperPreset === '4x6' ? 152.4 : paperPreset === 'a4' ? 297 : 150;
  $: paperHeight = paperPreset === '4x6' ? 101.6 : paperPreset === 'a4' ? 210 : 100;
  $: aspectRatio = photoWidth > 0 && photoHeight > 0 ? photoWidth / photoHeight : 35 / 45;
  $: {
    const dimensions = { photoWidth: photoWidth ?? NaN, photoHeight: photoHeight ?? NaN, paperWidth, paperHeight, gap: gap ?? NaN, margin: margin ?? NaN };
    const available = calculateLayout({ ...dimensions, copies: 1 });
    // A temporary blank or invalid field must not reset the user's chosen count.
    // Capacity can decrease the count, but more room never increases it.
    if (available.valid && Number.isInteger(copies) && copies > Math.min(available.capacity, 100)) {
      copies = Math.min(available.capacity, 100);
    }
    layout = calculateLayout({ ...dimensions, copies: copies ?? NaN });
  }
  $: effectiveDpi = crop && photoWidth > 0 && photoHeight > 0 ? Math.round(Math.min(crop.width / photoWidth, crop.height / photoHeight) * 25.4) : 0;
  $: matchingCrop = crop && Math.abs(crop.width / crop.height - aspectRatio) < 0.001 ? crop : null;
  $: ready = Boolean(matchingCrop && layout.valid && sheetCanvas && !loading && !cropPending);
  $: updatePreview(matchingCrop, layout, cutMarks);
  $: printCss = `@page { size: ${paperWidth}mm ${paperHeight}mm; margin: 0; }`;
  $: filenameBase = (sourceName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 70) || 'photo') + `-${photoWidth}x${photoHeight}mm`;

  onMount(() => {
    loadConfig();
    cameraSupported = Boolean(navigator.mediaDevices?.getUserMedia);
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      cancelAnimationFrame(previewFrame);
    };
  });

  async function loadConfig() {
    configError = '';
    try {
      const response = await fetch('/api/config', { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Could not load the Immich connection settings.');
      config = await response.json();
    } catch {
      configError = 'The app server is unavailable. Downloads still work. Start the included server to enable Immich.';
    }
    configLoaded = true;
  }

  function flash(message, kind = 'success') {
    notice = message;
    noticeKind = kind;
  }

  function withTimeout(promise, milliseconds, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })])
      .finally(() => clearTimeout(timer));
  }

  async function openCamera() {
    cameraOpen = true;
    await tick();
    cameraDialog.showModal();
  }

  function closeCamera() {
    cameraDialog?.close();
    cameraOpen = false;
  }

  function capturedPhoto(file) {
    closeCamera();
    loadFile(file);
  }

  async function loadFile(file) {
    if (!file) return;
    notice = '';
    savedUrl = '';
    if (file.size > 80 * 1024 * 1024) {
      flash('This file is larger than 80 MB. Choose a smaller photo.', 'error');
      return;
    }
    const isHeic = /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|avif|gif|bmp|heic|heif)$/i.test(file.name)) {
      flash('Choose an image file: JPEG, PNG, WebP, AVIF or HEIC.', 'error');
      return;
    }
    const version = ++fileVersion;
    loading = true;
    loadMessage = 'Opening your photo…';
    let newUrl = '';
    try {
      let imageFile = file;
      if (isHeic) {
        loadMessage = 'Converting HEIC on your device…';
        const { heicTo } = await withTimeout(import('heic-to/csp'), 15000, 'HEIC converter timed out');
        imageFile = await withTimeout(heicTo({ blob: file, type: 'image/jpeg', quality: 0.95 }), 45000, 'HEIC conversion timed out');
      }
      newUrl = URL.createObjectURL(imageFile);
      const image = new Image();
      image.src = newUrl;
      await withTimeout(image.decode(), 15000, 'Image decode timed out');
      if (version !== fileVersion) { URL.revokeObjectURL(newUrl); return; }
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid image size');
      if (image.naturalWidth * image.naturalHeight > 100_000_000) throw new Error('Photo exceeds 100 megapixels');
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      crop = null;
      sourceUrl = newUrl;
      sourceName = file.name;
      originalWidth = image.naturalWidth;
      originalHeight = image.naturalHeight;
    } catch (error) {
      if (newUrl) URL.revokeObjectURL(newUrl);
      if (version === fileVersion) flash(error.message === 'Photo exceeds 100 megapixels' ? 'This photo exceeds 100 megapixels. Export a smaller copy first.' : error.message?.includes('timed out') ? 'This photo took too long to open. Try a smaller file or export it as JPEG first.' : 'This image could not be opened. Try exporting it as JPEG or PNG first.', 'error');
    } finally {
      if (version === fileVersion) loading = false;
      if (fileInput) fileInput.value = '';
    }
  }

  function onDrop(event) {
    event.preventDefault();
    dragDepth = 0;
    dragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) loadFile(file);
    else flash('Download the original photo from Immich, then drop the image file here.', 'error');
  }

  function onDragEnter(event) {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    dragDepth += 1;
    dragOver = true;
  }

  function onDragLeave(event) {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragOver = false;
  }

  function changePhotoPreset() {
    if (photoPreset === 'custom') return;
    [photoWidth, photoHeight] = photoPreset.split('x').map(Number);
  }

  function onCustomSize() { /* Same-ratio sizes reuse the existing crop. */ }

  function updatePreview(currentCrop, currentLayout, marks) {
    cancelAnimationFrame(previewFrame);
    sheetCanvas = null;
    sheetUrl = '';
    outputError = '';
    savedUrl = '';
    if (!currentCrop || !currentLayout.valid) return;
    previewFrame = requestAnimationFrame(() => {
      try {
        sheetCanvas = renderSheet(currentCrop.canvas, currentLayout, { dpi: 300, cutMarks: marks });
        sheetUrl = sheetCanvas.toDataURL('image/jpeg', 0.92);
      } catch {
        outputError = 'The print sheet could not be generated. Try a smaller image or reload the page.';
      }
    });
  }

  async function exportFile(type) {
    if (!ready || busy) return;
    busy = type;
    try {
      const name = `${filenameBase}-${copies}up`;
      if (type === 'pdf') await downloadPdf(sheetCanvas, layout, `${name}.pdf`);
      else downloadBlob(await canvasToJpeg(sheetCanvas), `${name}.jpg`);
      flash(type === 'pdf' ? 'PDF ready. Print at actual size (100%).' : 'JPEG ready. Select the matching paper size when printing.');
    } catch { flash('The file could not be exported. Please try again.', 'error'); }
    finally { busy = ''; }
  }

  async function saveToImmich() {
    if (!ready || busy) return;
    if (!config.immichConfigured) { settingsDialog.showModal(); return; }
    busy = 'immich';
    savedUrl = '';
    const target = saveTarget;
    const filename = `${filenameBase}${target === 'sheet' ? `-${copies}up` : '-crop'}.jpg`;
    const sourceVersion = fileVersion;
    const uploadPhotoWidth = String(photoWidth);
    const uploadPhotoHeight = String(photoHeight);
    try {
      let canvas = sheetCanvas;
      if (target === 'photo') {
        canvas = document.createElement('canvas');
        canvas.width = Math.round(photoWidth / 25.4 * 300);
        canvas.height = Math.round(photoHeight / 25.4 * 300);
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingQuality = 'high';
        context.drawImage(crop.canvas, 0, 0, canvas.width, canvas.height);
      }
      const blob = await canvasToJpeg(canvas);
      if (blob.size > config.maxUploadBytes) throw new Error('This file exceeds the server upload limit. Download the JPEG and upload it in Immich.');
      const response = await fetch('/api/immich/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'X-Filename': filename, 'X-Photo-Width': uploadPhotoWidth, 'X-Photo-Height': uploadPhotoHeight },
        body: blob,
        signal: AbortSignal.timeout(65000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Immich could not save the image. Check your server connection.');
      if (sourceVersion === fileVersion && data.url && /^https?:\/\//.test(data.url)) savedUrl = data.url;
      const savedMessage = data.status === 'duplicate' ? 'This image is already in your Immich library.' : sourceVersion !== fileVersion ? `${filename} saved to Immich.` : `${target === 'sheet' ? 'Print sheet' : 'Cropped photo'} saved to Immich.`;
      flash(data.warning ? `${savedMessage} ${data.warning}` : savedMessage, data.warning ? 'warning' : 'success');
    } catch (error) {
      flash(error.name === 'TimeoutError' ? 'Immich took too long to respond. Check your library before retrying.' : error.message || 'Could not save to Immich.', 'error');
    } finally { busy = ''; }
  }

  function printSheet() {
    if (!ready) return;
    window.print();
  }
</script>

<svelte:head>{@html `<style>${printCss}</style>`}</svelte:head>
<svelte:window ondragenter={onDragEnter} ondragleave={onDragLeave} ondragover={(event) => event.preventDefault()} ondrop={onDrop} />

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="Passport Photo Printer home">
      <span class="brand-mark"><Icon name="crop" size={25} /></span>
      <span>Passport Photo <strong>Printer</strong></span>
    </a>
    <button class="connection-button" onclick={() => settingsDialog.showModal()} aria-label="Immich connection settings" title="Immich connection settings">
      <span class:connected={config.immichConfigured} class="status-dot"></span>
      <span>{config.immichConfigured ? 'Immich configured' : 'Connect Immich'}</span>
      <Icon name="settings" size={17} />
    </button>
  </header>

  <main>
    <div class="page-heading">
      <div><h1>Prepare a photo print</h1><p>Your crop. The right size. Ready for photo paper.</p></div>
      <span class="privacy-note"><Icon name="shield" size={17} /> Photos stay on your device until you save to Immich</span>
    </div>

    {#if notice}
      <div class:error={noticeKind === 'error'} class:warning={noticeKind === 'warning'} class="notice" role={noticeKind === 'success' ? 'status' : 'alert'}>
        <Icon name={noticeKind === 'success' ? 'check' : 'info'} size={19} />
        <span>{notice}{#if savedUrl} <a href={savedUrl} target="_blank" rel="noopener noreferrer">Open in Immich <Icon name="arrow" size={14}/></a>{/if}</span>
        <button class="icon-button" aria-label="Dismiss message" onclick={() => notice = ''}><Icon name="close" size={17} /></button>
      </div>
    {/if}

    <div class="workspace">
      <section class="editor-panel" aria-labelledby="photo-heading">
        <div class="section-heading"><h2 id="photo-heading"><Icon name="crop" size={19} /> Photo</h2>{#if sourceUrl}<div class="photo-heading-actions"><button class="text-button" onclick={() => fileInput.click()} disabled={loading}>Change photo</button>{#if cameraSupported}<button class="text-button camera-text-button" onclick={openCamera} disabled={loading}><Icon name="camera" size={16} /> Take photo</button>{/if}</div>{/if}</div>
        <input class="visually-hidden" bind:this={fileInput} type="file" id="photo-file" accept="image/*,.heic,.heif" onchange={(event) => loadFile(event.currentTarget.files?.[0])} aria-label="Choose photo" />

        <div class="editor-stage" class:has-photo={sourceUrl} aria-busy={loading}>
          {#if sourceUrl}
            {#key sourceUrl}<CropEditor src={sourceUrl} {aspectRatio} {showGuide} onCropChange={(value) => crop = value} onCropPending={(value) => cropPending = value} />{/key}
          {:else}
            <div class="drop-zone">
              <span class="drop-illustration"><Icon name="image" size={48} /><span class="upload-badge"><Icon name="upload" size={20}/></span></span>
              <span class="drop-title">Drop a photo here</span>
              <span class="drop-subtitle">or choose a file from your device</span>
              <div class="source-actions"><button class="choose-file" onclick={() => fileInput.click()} disabled={loading}>Choose photo</button>{#if cameraSupported}<button class="take-photo-button" onclick={openCamera} disabled={loading}><Icon name="camera" size={17} /> Take photo</button>{/if}</div>
              <span class="format-note">JPEG, PNG, WebP, AVIF, HEIC and more</span>
            </div>
          {/if}
          {#if loading}<div class="loading-overlay" role="status"><span class="spinner"></span>{loadMessage}</div>{/if}
        </div>

        {#if sourceUrl}<div class="file-meta"><span title={sourceName}>{sourceName}</span><span>{originalWidth} × {originalHeight} px</span></div>{/if}

        <div class="photo-settings">
          <div class="field"><label for="photo-size">Photo size / aspect ratio</label><select id="photo-size" bind:value={photoPreset} onchange={changePhotoPreset}><option value="35x45">35 × 45 mm</option><option value="30x40">30 × 40 mm</option><option value="50.8x50.8">2 × 2 in (50.8 × 50.8 mm)</option><option value="50x70">50 × 70 mm</option><option value="custom">Custom size</option></select></div>
          {#if photoPreset === 'custom'}
            <div class="custom-size-row"><div class="field"><label for="photo-width">Width (mm)</label><input id="photo-width" type="number" min="5" max="300" step="0.1" bind:value={photoWidth} oninput={onCustomSize}/></div><span>×</span><div class="field"><label for="photo-height">Height (mm)</label><input id="photo-height" type="number" min="5" max="300" step="0.1" bind:value={photoHeight} oninput={onCustomSize}/></div></div>
          {:else}<div class="aspect-note"><span class="mini-crop" style={`aspect-ratio: ${aspectRatio}`}></span><span>Fixed ratio<br/><strong>{photoWidth} × {photoHeight} mm per photo</strong></span></div>{/if}
        </div>
        <div class="guide-settings"><label class="guide-switch"><input type="checkbox" role="switch" bind:checked={showGuide}/><span class="switch-track" aria-hidden="true"></span><span>Passport guide</span></label>{#if showGuide}<span class="guide-help">Minimum and maximum head outlines</span>{/if}</div>
        <p class="section-help">Move and resize the crop box to choose the area you want to print.</p>
        {#if crop && effectiveDpi < 200}<p class="quality-note"><Icon name="info" size={16} /> This crop has about {effectiveDpi} pixels per inch at print size. A larger source photo will look sharper.</p>{/if}
      </section>

      <section class="print-panel" aria-labelledby="print-heading">
        <div class="section-heading"><h2 id="print-heading"><Icon name="printer" size={19} /> Print sheet</h2><span class="output-label">300 dpi</span></div>
        <div class="paper-stage">
          <div class="paper-width">{paperWidth} mm</div>
          <div class="paper" style={`aspect-ratio: ${paperWidth} / ${paperHeight}`}>
            {#if sheetUrl}<img src={sheetUrl} alt={`Print preview: ${copies} copies at ${photoWidth} by ${photoHeight} millimeters on ${paperWidth} by ${paperHeight} millimeter paper`} />
            {:else if layout.valid}
              {#each layout.placements as place}<div class="photo-placeholder" style={`left:${place.x / paperWidth * 100}%;top:${place.y / paperHeight * 100}%;width:${place.width / paperWidth * 100}%;height:${place.height / paperHeight * 100}%`}><Icon name="image" size={22} /></div>{/each}
            {:else}<div class="paper-empty"><Icon name="image" size={32}/><span>Adjust the layout to fit your photos</span></div>{/if}
          </div>
          <div class="paper-caption"><span>{layout.valid ? `${copies} ${copies === 1 ? 'photo' : 'photos'} per sheet` : 'Layout needs adjustment'}</span><span>{paperWidth} × {paperHeight} mm</span></div>
        </div>

        <div class="print-settings">
          <div class="two-fields"><div class="field"><label for="paper-size">Paper size</label><select id="paper-size" bind:value={paperPreset}><option value="10x15">10 × 15 cm</option><option value="4x6">4 × 6 inches</option><option value="a4">A4 landscape</option></select></div><div class="field copies-field"><label for="copies">Copies</label><input id="copies" type="number" min="1" max="100" step="1" bind:value={copies}/></div></div>
          <details class="layout-options"><summary>Spacing and cutting guides</summary><div class="two-fields"><div class="field"><label for="gap">Photo spacing (mm)</label><input id="gap" type="number" min="0" max="20" step="0.5" bind:value={gap}/></div><div class="field"><label for="margin">Minimum margin (mm)</label><input id="margin" type="number" min="0" max="30" step="0.5" bind:value={margin}/></div></div><label class="checkbox-field"><input type="checkbox" bind:checked={cutMarks}/> Show cutting guides</label></details>
          {#if !layout.valid}<div class="layout-error" role="alert"><span>{layout.error}</span></div>{/if}
          {#if outputError}<div class="layout-error" role="alert">{outputError}</div>{/if}
        </div>

        <div class="export-actions">
          <button class="primary-button" onclick={() => exportFile('jpeg')} disabled={!ready || Boolean(busy)}><Icon name="download"/>{busy === 'jpeg' ? 'Preparing JPEG…' : 'Download JPEG'}</button>
          <div class="two-buttons"><button class="secondary-button" onclick={() => exportFile('pdf')} disabled={!ready || Boolean(busy)}><Icon name="file" size={18}/>{busy === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}</button><button class="secondary-button" onclick={printSheet} disabled={!ready || Boolean(busy)}><Icon name="printer" size={18}/>Print</button></div>
          <p class="print-help">Print at <strong>actual size (100%)</strong>. Match the paper size and turn off “fill page” or borderless enlargement.</p>
        </div>

        <div class="immich-save">
          <div class="save-heading"><span class="immich-symbol"><span></span><span></span><span></span><span></span><span></span></span><h3>Keep it in Immich</h3><button class="icon-button" aria-label="Immich setup" onclick={() => settingsDialog.showModal()}><Icon name="settings" size={17}/></button></div>
          <div class="save-controls"><select bind:value={saveTarget} aria-label="Image to save to Immich"><option value="sheet">Print sheet</option><option value="photo">Single cropped photo</option></select><button class="immich-button" onclick={saveToImmich} disabled={!ready || Boolean(busy)}><Icon name="cloud" size={18}/>{busy === 'immich' ? 'Saving…' : 'Save to Immich'}</button></div>
          {#if configLoaded && !config.immichConfigured}<p class="immich-help">Connect your server once to save photos directly to your library.</p>{/if}
        </div>
      </section>
    </div>
    <footer><span>Passport Photo Printer</span><span>Crop and print, at home.</span></footer>
  </main>
</div>

{#if dragOver}<div class="drop-overlay"><Icon name="upload" size={44}/><strong>Drop to open your photo</strong><span>The original stays unchanged</span></div>{/if}

<dialog bind:this={settingsDialog} class="settings-dialog" aria-labelledby="connection-title">
  <div class="dialog-heading"><h2 id="connection-title">Immich connection</h2><button class="icon-button" aria-label="Close Immich settings" onclick={() => settingsDialog.close()}><Icon name="close"/></button></div>
  {#if config.immichConfigured}<p class="connected-message"><Icon name="check"/> Immich is configured and ready to receive your images.</p><p>“Save to Immich” uploads the selected print sheet or cropped photo to the account associated with your server’s API key.</p>
  {:else}<p>Add your Immich connection to the app’s <code>.env</code> file, then recreate the container.</p><pre>IMMICH_URL=http://immich-server:2283
IMMICH_API_KEY=your-api-key
IMMICH_PUBLIC_URL=https://photos.example.com</pre><p>Create a key in Immich’s <strong>Account settings → API keys</strong> with <code>asset.upload</code>, <code>tag.create</code> and <code>tag.asset</code> permissions. The public URL is optional and adds an “Open in Immich” link.</p><p>Use an address that this container can reach. If Immich is in another Docker stack, connect both services to a shared network or use the server’s LAN address.</p>{/if}
  {#if configError}<p class="layout-error">{configError}</p>{/if}
  <p class="dialog-note"><Icon name="shield" size={18}/> The API key stays on the server. Cropping and downloads happen on your device.</p>
  <div class="dialog-actions"><button class="secondary-button" onclick={loadConfig}>Refresh connection</button><button class="primary-button" onclick={() => settingsDialog.close()}>Done</button></div>
</dialog>

<dialog bind:this={cameraDialog} class="camera-dialog" aria-labelledby="camera-title" onclose={() => cameraOpen = false}>
  {#if cameraOpen}<CameraCapture {aspectRatio} {showGuide} onToggleGuide={(value) => showGuide = value} onCapture={capturedPhoto} onClose={closeCamera} />{/if}
</dialog>

{#if sheetUrl}<div class="print-only" style={`width:${paperWidth}mm;height:${paperHeight}mm`}><img src={sheetUrl} alt="Printable sheet"/></div>{/if}
