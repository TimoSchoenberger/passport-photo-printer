<script>
  export let style = '';
</script>

<div class="passport-guide" {style}>
  <svg viewBox="0 0 350 450" preserveAspectRatio="none" role="img" aria-label="Passport guide: maximum solid head outline, minimum dashed head outline, eye area and center line">
    <rect class="eye-area" x="0" y="135" width="350" height="90" />
    <path class="guide-reference" d="M175 0V450 M0 135H350 M0 225H350" />
    <path class="head-max" d="M175 25 C105 25 73 75 73 142 C73 230 109 370 175 385 C241 370 277 230 277 142 C277 75 245 25 175 25Z" />
    <path class="head-min" d="M175 65 C117 65 89 108 89 169 C89 247 122 372 175 385 C228 372 261 247 261 169 C261 108 233 65 175 65Z" />
    <path class="guide-shoulders" d="M137 367 C141 399 114 409 85 417 L12 448 M213 367 C209 399 236 409 265 417 L338 448 M139 393 Q175 421 211 393" />
    <g class="guide-label"><rect x="284" y="17" width="56" height="24" rx="6"/><text x="312" y="34" text-anchor="middle">Max</text></g>
    <g class="guide-label"><rect x="270" y="57" width="56" height="24" rx="6"/><text x="298" y="74" text-anchor="middle">Min</text></g>
  </svg>
</div>

<style>
  .passport-guide { position: absolute; z-index: 2; pointer-events: none; overflow: hidden; }
  svg { display: block; width: 100%; height: 100%; overflow: visible; }
  path { fill: none; vector-effect: non-scaling-stroke; filter: drop-shadow(0 1px 1px #000b); }
  .eye-area { fill: #a9c7ff18; }
  .guide-reference { stroke: #fff9; stroke-width: 1; stroke-dasharray: 4 4; }
  .head-max { stroke: #c0dbff; stroke-width: 1.8; }
  .head-min { stroke: #fff; stroke-width: 1.5; stroke-dasharray: 5 4; }
  .guide-shoulders { stroke: #ffffffb3; stroke-width: 1.2; }
  .guide-label rect { fill: #172232c9; }
  .guide-label text { fill: #f1f6ff; font: 15px 'Overpass Variable', Arial, sans-serif; }
</style>
