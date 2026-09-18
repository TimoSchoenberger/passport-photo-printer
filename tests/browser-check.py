"""End-to-end checks against the production build and a local fake Immich.

Run tests/browser-server.mjs first, then this script with Python + Playwright,
Pillow and pypdf installed. Uses installed Edge on Windows, Chromium elsewhere.
"""
import base64
import io
import json
import os
from pathlib import Path
import urllib.request

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
URL = 'http://127.0.0.1:18096'


def fixture():
    # Deliberately asymmetric portrait-like test pattern catches rotation/crop bugs.
    pic = Image.new('RGB', (1600, 1200), '#acc7d3')
    draw = ImageDraw.Draw(pic)
    for y in range(1200):
        draw.line((0, y, 1600, y), fill=(166 + y // 30, 193 + y // 40, 199 + y // 50))
    draw.rounded_rectangle((350, 730, 1250, 1450), radius=290, fill='#34546b')
    draw.ellipse((585, 210, 1025, 780), fill='#d8a58c')
    draw.pieslice((570, 165, 1040, 620), 160, 350, fill='#493b37')
    draw.ellipse((691, 425, 708, 440), fill='#443e3a')
    draw.ellipse((902, 425, 919, 440), fill='#443e3a')
    draw.arc((742, 500, 877, 600), 5, 170, fill='#8d544b', width=8)
    draw.rectangle((40, 40, 160, 160), fill='#dd786c')
    draw.rectangle((1430, 1010, 1550, 1160), fill='#758e54')
    pic.save(OUT / 'source.jpg', quality=95)
    return OUT / 'source.jpg'


def upload_info():
    with urllib.request.urlopen('http://127.0.0.1:18097/test/upload') as response:
        return json.load(response)


with sync_playwright() as p:
    launch = {'headless': True, 'args': ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']}
    if os.name == 'nt':
        launch['channel'] = 'msedge'
    browser = p.chromium.launch(**launch)
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, device_scale_factor=1)
    errors = []
    requests = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.goto(URL)
    page.wait_for_load_state('networkidle')
    manifest = page.evaluate("async () => (await fetch('/manifest.webmanifest')).json()")
    assert manifest['display'] == 'standalone'
    assert any(icon.get('purpose') == 'maskable' for icon in manifest['icons'])
    worker_scope = page.evaluate("async () => (await navigator.serviceWorker.ready).scope")
    assert worker_scope == f'{URL}/'
    assert Image.open(ROOT / 'public' / 'pwa-192x192.png').size == (192, 192)
    assert Image.open(ROOT / 'public' / 'pwa-512x512.png').size == (512, 512)
    print('Initial buttons:', page.get_by_role('button').all_text_contents())
    page.screenshot(path=str(OUT / 'empty-desktop.png'), full_page=True)
    expect(page.get_by_role('button', name='Download JPEG')).to_be_disabled()
    expect(page.get_by_role('button', name='Immich connection settings')).to_be_visible()
    page.get_by_role('button', name='Take photo').click()
    camera = page.get_by_role('dialog', name='Take a photo')
    expect(camera).to_be_visible()
    shutter = camera.get_by_role('button', name='Take photo')
    expect(shutter).to_be_enabled(timeout=15000)
    camera.get_by_label('Passport guide').check()
    expect(camera.locator('.passport-guide')).to_be_visible()
    page.screenshot(path=str(OUT / 'camera-desktop.png'), full_page=True)
    shutter.click()
    expect(camera).not_to_be_visible(timeout=20000)
    expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled(timeout=15000)
    expect(page.locator('.file-meta')).to_contain_text('camera-')
    page.get_by_role('button', name='Take photo').click()
    expect(camera.get_by_role('button', name='Take photo')).to_be_enabled(timeout=15000)
    page.evaluate("window.__cameraTrack = document.querySelector('.camera-dialog video').srcObject.getVideoTracks()[0]")
    camera.get_by_role('button', name='Close camera').click()
    expect(camera).not_to_be_visible()
    assert page.evaluate("window.__cameraTrack.readyState") == 'ended', 'Camera track still active after closing'
    heic = ROOT / 'tests' / 'fixtures' / 'portrait.heic'
    page.get_by_label('Choose photo', exact=True).set_input_files(str(heic))
    expect(page.locator('.file-meta')).to_contain_text('portrait.heic', timeout=60000)
    expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled(timeout=15000)
    assert page.locator('.crop-viewport > img').evaluate('(image) => image.naturalWidth') == 96
    larger_heic = OUT / 'example.heic'
    last_heic_name = 'portrait.heic'
    if larger_heic.exists():
        page.get_by_label('Choose photo', exact=True).set_input_files(str(larger_heic))
        expect(page.locator('.file-meta')).to_contain_text('example.heic', timeout=60000)
        expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled(timeout=15000)
        last_heic_name = 'example.heic'
    page.get_by_label('Choose photo', exact=True).set_input_files({'name':'broken.heic','mimeType':'image/heic','buffer':b'not a heic file'})
    expect(page.get_by_role('alert')).to_contain_text('could not be opened', timeout=15000)
    expect(page.locator('.file-meta')).to_contain_text(last_heic_name)
    page.get_by_role('button', name='Dismiss message').click()
    source = fixture()
    # Exercise actual drag and drop, not only the file picker.
    encoded = base64.b64encode(source.read_bytes()).decode()
    page.evaluate("""(base64) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const data = new DataTransfer(); data.items.add(new File([bytes], 'portrait.jpg', {type:'image/jpeg'}));
      window.dispatchEvent(new DragEvent('drop', {dataTransfer:data,bubbles:true,cancelable:true}));
    }""", encoded)
    expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled(timeout=15000)
    print('Crop controls:', page.get_by_role('group', name='Crop controls').get_by_role('button').all_text_contents())
    preview = page.locator('.paper > img')
    expect(preview).to_have_attribute('alt', 'Print preview: 8 copies at 35 by 45 millimeters on 150 by 100 millimeter paper')
    guide_switch = page.get_by_role('switch', name='Passport guide')
    expect(guide_switch).to_be_checked()  # Camera and crop use the same guide preference.
    guide_switch.uncheck()
    clean_preview = preview.get_attribute('src')
    guide_switch.check()
    guide = page.locator('.passport-guide')
    expect(guide).to_be_visible()
    expect(guide.get_by_text('Min', exact=True)).to_be_visible()
    expect(guide.get_by_text('Max', exact=True)).to_be_visible()
    assert 'mm' not in guide.inner_text()
    assert preview.get_attribute('src') == clean_preview, 'Guide leaked into exported sheet'
    guide_switch.uncheck()
    expect(guide).not_to_be_visible()
    guide_switch.check()
    page.screenshot(path=str(OUT / 'editor-desktop.png'), full_page=True)
    before = preview.get_attribute('src')
    page.get_by_role('button', name='Make crop smaller').click()
    page.wait_for_function('(old) => document.querySelector(".paper > img")?.src !== old', arg=before)
    before = preview.get_attribute('src')
    page.get_by_role('button', name='Move crop right', exact=True).click()
    page.wait_for_function('(old) => document.querySelector(".paper > img")?.src !== old', arg=before)
    before = preview.get_attribute('src')
    page.get_by_role('button', name='Zoom in', exact=True).click()
    page.wait_for_function('(old) => document.querySelector(".paper > img")?.src !== old', arg=before)
    page.get_by_role('button', name='Rotate right 90 degrees').click()
    expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled()
    page.get_by_role('button', name='Reset', exact=True).click()
    expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled()
    # Same ratio transitions and clear/restore custom input must keep exports alive.
    page.get_by_label('Photo size / aspect ratio').select_option('custom')
    page.get_by_label('Photo size / aspect ratio').select_option('35x45')
    expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled()
    page.get_by_label('Photo size / aspect ratio').select_option('custom')
    page.get_by_label('Width (mm)', exact=True).fill('')
    expect(page.get_by_role('button', name='Download JPEG')).to_be_disabled()
    page.get_by_label('Width (mm)', exact=True).fill('35')
    expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled()
    page.get_by_label('Photo size / aspect ratio').select_option('50.8x50.8')
    expect(page.get_by_label('Copies', exact=True)).to_have_value('2')
    expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled()
    box = page.locator('.cropper-crop-box').bounding_box()
    assert abs(box['width'] / box['height'] - 1) < .01
    page.get_by_label('Photo size / aspect ratio').select_option('35x45')
    expect(page.get_by_label('Copies', exact=True)).to_have_value('2')
    page.get_by_label('Copies', exact=True).fill('99')
    expect(page.get_by_label('Copies', exact=True)).to_have_value('8')
    page.get_by_label('Copies', exact=True).fill('')
    expect(page.get_by_role('button', name='Download JPEG')).to_be_disabled()
    page.get_by_label('Copies', exact=True).fill('8')
    expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled()
    page.get_by_label('Paper size').select_option('4x6')
    expect(preview).to_have_attribute('alt', 'Print preview: 8 copies at 35 by 45 millimeters on 152.4 by 101.6 millimeter paper')
    page.get_by_label('Paper size').select_option('10x15')
    expect(preview).to_have_attribute('alt', 'Print preview: 8 copies at 35 by 45 millimeters on 150 by 100 millimeter paper')
    with page.expect_download() as download:
        page.get_by_role('button', name='Download JPEG').click()
    download.value.save_as(str(OUT / 'sheet.jpg'))
    jpg = Image.open(OUT / 'sheet.jpg')
    assert jpg.size == (1772, 1181), jpg.size
    assert jpg.info.get('dpi') == (300, 300), jpg.info
    with page.expect_download() as download:
        page.get_by_role('button', name='Download PDF').click()
    download.value.save_as(str(OUT / 'sheet.pdf'))
    pdf = PdfReader(OUT / 'sheet.pdf')
    assert len(pdf.pages) == 1
    assert abs(float(pdf.pages[0].mediabox.width) * 25.4 / 72 - 150) < .001
    assert abs(float(pdf.pages[0].mediabox.height) * 25.4 / 72 - 100) < .001
    # Verify the real browser → app server → mocked Immich round trip and bytes.
    page.get_by_role('button', name='Save to Immich', exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('Print sheet saved to Immich.')
    info = upload_info()
    assert info['keyCorrect'] and info['type'] == 'image/jpeg'
    assert info['tagsApplied'] and set(info['tags']) == {'pass photo', '35x45 mm'}, info
    uploaded = Image.open(io.BytesIO(base64.b64decode(info['jpeg'])))
    assert uploaded.size == (1772, 1181)
    assert uploaded.info.get('dpi') == (300, 300)
    page.get_by_role('button', name='Save to Immich', exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('already in your Immich library')
    assert set(upload_info()['tags']) == {'pass photo', '35x45 mm'}
    page.get_by_label('Image to save to Immich').select_option('photo')
    page.get_by_role('button', name='Save to Immich', exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('Cropped photo saved to Immich.')
    uploaded = Image.open(io.BytesIO(base64.b64decode(upload_info()['jpeg'])))
    assert uploaded.size == (413, 531)
    assert set(upload_info()['tags']) == {'pass photo', '35x45 mm'}
    urllib.request.urlopen('http://127.0.0.1:18097/test/fail-tags').close()
    page.get_by_role('button', name='Save to Immich', exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('tag')
    expect(page.locator('.notice.warning')).to_be_visible()
    page.get_by_role('button', name='Dismiss message').click()
    urllib.request.urlopen('http://127.0.0.1:18097/test/fail').close()
    page.get_by_role('button', name='Save to Immich', exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('asset.upload permission')
    assert 'test-secret-never-expose' not in page.content()
    page.get_by_role('button', name='Dismiss message').click()
    # Print stylesheet hides the UI and retains exact physical dimensions.
    page.emulate_media(media='print')
    assert not page.locator('.app-shell').is_visible()
    rect = page.locator('.print-only').bounding_box()
    assert abs(rect['width'] - 150 / 25.4 * 96) < .1
    assert abs(rect['height'] - 100 / 25.4 * 96) < .1
    page.emulate_media(media='screen')
    # Unsupported replacement reports a useful error without removing the crop.
    page.get_by_label('Choose photo', exact=True).set_input_files({'name':'test.txt','mimeType':'text/plain','buffer':b'not an image'})
    expect(page.get_by_role('alert')).to_contain_text('Choose an image file')
    expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled()
    page.get_by_role('button', name='Dismiss message').click()
    page.get_by_label('Choose photo', exact=True).set_input_files(str(source))
    expect(page.get_by_role('button', name='Download JPEG')).to_be_enabled()
    before_resize = page.locator('.crop-viewport > img').evaluate('(el)=>el.cropper.getData()')
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(400)
    after_resize = page.locator('.crop-viewport > img').evaluate('(el)=>el.cropper.getData()')
    for key in ['x', 'y', 'width', 'height']:
        assert abs(before_resize[key] - after_resize[key]) < 1, (key, before_resize, after_resize)
    crop_bounds = page.locator('.cropper-crop-box').bounding_box()
    guide_bounds = guide.bounding_box()
    for key in ['x', 'y', 'width', 'height']:
        assert abs(crop_bounds[key] - guide_bounds[key]) < 1.1, (key, crop_bounds, guide_bounds)
    page.get_by_role('button', name='Take photo').click()
    mobile_camera = page.get_by_role('dialog', name='Take a photo')
    expect(mobile_camera.get_by_role('button', name='Take photo')).to_be_enabled(timeout=15000)
    expect(mobile_camera.locator('.passport-guide')).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile camera overflow'
    page.screenshot(path=str(OUT / 'camera-mobile.png'), full_page=True)
    page.evaluate("window.__cameraTrack = document.querySelector('.camera-dialog video').srcObject.getVideoTracks()[0]")
    page.keyboard.press('Escape')
    expect(mobile_camera).not_to_be_visible()
    page.wait_for_function("() => window.__cameraTrack.readyState === 'ended'", timeout=5000)
    select_styles = page.locator('select').evaluate_all('(els)=>els.map(el=>({appearance:getComputedStyle(el).appearance,background:getComputedStyle(el).backgroundImage,position:getComputedStyle(el).backgroundPosition,padding:getComputedStyle(el).paddingRight}))')
    assert all(s['appearance'] == 'none' and s['background'] != 'none' and '14px' in s['position'] and s['padding'] == '40px' for s in select_styles), select_styles
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile overflow'
    page.screenshot(path=str(OUT / 'editor-mobile.png'), full_page=True)
    page.get_by_role('button', name='Immich connection settings').click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).not_to_be_visible()
    page.set_viewport_size({'width':1440,'height':1100})
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / 'editor-desktop.png'), full_page=True)
    assert not errors, errors
    assert all(url.startswith(('http://127.0.0.1:', 'blob:', 'data:')) for url in requests), requests
    print('PASS: camera capture/cleanup, shared guide, HEIC decode/errors, crop and clean exports, automatic capacity, formats, responsive layout, JPEG300dpi/PDF, Immich tags and partial-failure warnings; no page errors or external requests.')
    browser.close()
