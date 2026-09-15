<script>
  export let name;
  export let size = 20;
  const paths = {
    crop: 'M6 3v12a3 3 0 0 0 3 3h12M3 6h12a3 3 0 0 1 3 3v12',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
    image: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm-1 13 5-5 5 5 3-3 5 5M8 7h.01',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
    printer: 'M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v7H6zM17 11h.01',
    cloud: 'M7 18H6a4 4 0 0 1-1-7.87A7 7 0 0 1 18.7 9a4.5 4.5 0 0 1-.2 9H17M12 21V12m-3 3 3-3 3 3',
    settings: 'm9 3-.5 3-2 1L4 6 2 10l2.5 2v2L2 16l2 4 2.5-1 2 1L9 23h6l.5-3 2-1 2.5 1 2-4-2.5-2v-2L22 10l-2-4-2.5 1-2-1L15 3H9ZM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    info: 'M12 17v-5m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    close: 'm6 6 12 12M6 18 18 6',
    check: 'm5 12 4 4L19 6',
    file: 'M14 2H5v20h14V7l-5-5Zm0 0v5h5M8 12h8M8 16h6',
    arrow: 'M7 17 17 7M7 7h10v10',
    shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-6',
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name] || paths.image} /></svg>
