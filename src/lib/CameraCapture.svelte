<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import PassportGuide from './PassportGuide.svelte';

  export let aspectRatio = 35 / 45;
  export let showGuide = false;
  export let onToggleGuide = () => {};
  export let onCapture = () => {};
  export let onClose = () => {};

  let video;
  let stream;
  let facing = 'user';
  let cameraCount = 0;
  let ready = false;
  let error = '';
  let capturing = false;
  let disposed = false;
  let requestId = 0;

  onMount(() => {
    startCamera();
    return () => {
      disposed = true;
      requestId += 1;
      stopCamera();
    };
  });

  function stopCamera() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (video) video.srcObject = null;
    ready = false;
  }

  async function startCamera() {
    const currentRequest = ++requestId;
    stopCamera();
    error = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      error = 'Camera access requires HTTPS or localhost. You can still choose a photo from your device.';
      return;
    }
    try {
      const opened = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (disposed || currentRequest !== requestId) {
        for (const track of opened.getTracks()) track.stop();
        return;
      }
      stream = opened;
      video.srcObject = opened;
      await video.play();
      ready = video.videoWidth > 0 && video.videoHeight > 0;
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!disposed && currentRequest === requestId) cameraCount = devices.filter((device) => device.kind === 'videoinput').length;
    } catch (caught) {
      if (disposed || currentRequest !== requestId) return;
      stopCamera();
      error = caught?.name === 'NotAllowedError' ? 'Camera access was denied. Allow camera permission in your browser and try again.'
        : caught?.name === 'NotFoundError' ? 'No camera was found on this device.'
        : 'The camera could not be started. Try again or choose a photo instead.';
    }
  }

  function switchCamera() {
    facing = facing === 'user' ? 'environment' : 'user';
    startCamera();
  }

  async function capture() {
    if (!ready || capturing || !video.videoWidth || !video.videoHeight) return;
    capturing = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('No photo was captured')), 'image/jpeg', 0.95));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      onCapture(new File([blob], `camera-${stamp}.jpg`, { type: 'image/jpeg' }));
    } catch {
      error = 'The photo could not be captured. Please try again.';
      capturing = false;
    }
  }
</script>

<div class="camera-header">
  <div><h2 id="camera-title"><Icon name="camera" size={21} /> Take a photo</h2><p>Line up your face, then fine-tune the crop after capture.</p></div>
  <button class="camera-close" type="button" aria-label="Close camera" onclick={onClose}><Icon name="close" size={21} /></button>
</div>

<div class="camera-view" style={`--camera-ratio:${aspectRatio}`}>
  <video bind:this={video} autoplay muted playsinline aria-label="Live camera preview"></video>
  {#if showGuide && ready}<PassportGuide style="inset:0;width:100%;height:100%" />{/if}
  {#if !ready}<div class="camera-status" role="status">{error || 'Starting camera…'}</div>{/if}
</div>

<div class="camera-controls">
  <label class="camera-guide-toggle"><input type="checkbox" checked={showGuide} onchange={(event) => onToggleGuide(event.currentTarget.checked)} /> Passport guide</label>
  <div class="camera-actions">
    {#if cameraCount > 1}<button class="camera-secondary" type="button" onclick={switchCamera} aria-label="Switch camera"><Icon name="switch-camera" size={18} /> Switch</button>{/if}
    {#if error}<button class="camera-secondary" type="button" onclick={startCamera}>Try again</button>{/if}
    <button class="camera-shutter" type="button" onclick={capture} disabled={!ready || capturing}><Icon name="camera" size={19} /> {capturing ? 'Capturing…' : 'Take photo'}</button>
  </div>
</div>

<style>
  .camera-header { display:flex;justify-content:space-between;align-items:start;gap:16px;margin-bottom:18px; }
  .camera-header h2 { display:flex;align-items:center;gap:9px;font-size:20px;font-weight:550; }
  .camera-header h2 :global(svg) { color:var(--accent); }
  .camera-header p { color:#9ca7b8;font-size:12px;line-height:1.5;margin-top:5px; }
  .camera-close { display:grid;place-items:center;flex:none;width:36px;height:36px;border:0;border-radius:50%;background:#303641;color:#d5dfec; }
  .camera-view { position:relative;margin:auto;aspect-ratio:var(--camera-ratio);width:min(100%, 420px, calc((100dvh - 260px) * var(--camera-ratio)));min-width:0;max-height:calc(100dvh - 260px);overflow:hidden;border:1px solid #516078;border-radius:12px;background:#0d1016; }
  video { display:block;width:100%;height:100%;object-fit:cover; }
  .camera-status { position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:#c5d0df;font-size:14px;line-height:1.5;background:#10141c; }
  .camera-controls { display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-top:18px; }
  .camera-guide-toggle { display:flex;align-items:center;gap:8px;color:#c0c9d6;font-size:13px;cursor:pointer; }
  .camera-guide-toggle input { width:16px;height:16px;margin:0;accent-color:var(--accent); }
  .camera-actions { display:flex;align-items:center;gap:9px;margin-left:auto; }
  .camera-secondary,.camera-shutter { display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:9px 15px;border-radius:22px;font-size:13px;font-weight:550;white-space:nowrap; }
  .camera-secondary { border:1px solid #4b586a;background:#28313d;color:#d2def0; }
  .camera-shutter { border:0;background:var(--accent);color:#18263b; }
  .camera-shutter:disabled { opacity:.4; }
  @media(max-width:520px){.camera-header{margin-bottom:12px}.camera-controls{align-items:stretch}.camera-guide-toggle{width:100%}.camera-actions{width:100%}.camera-shutter{flex:1}.camera-view{width:min(100%, calc((100dvh - 290px) * var(--camera-ratio)));max-height:calc(100dvh - 290px)}}
</style>
