/* global window, document, gsap, fetch */
window.__timelines = window.__timelines || {};
window.motionReady = (async () => {
  const timing = await (await fetch('timeline.json')).json();
  await document.fonts.ready;
  await Promise.all([...document.images].map((image) => image.decode()));
  for (let i = 0; i < 153; i++) {
    const bar = document.createElement('i');
    bar.className = 'bar';
    bar.style.height = `${7 + 40 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.31))}px`;
    document.getElementById('waveform').append(bar);
  }
  for (let i = 0; i < 5; i++) {
    const shutter = document.createElement('div');
    shutter.className = 'shutter';
    shutter.style.left = `${i * 20}%`;
    shutter.style.backgroundPosition = `${-i * 384}px center`;
    document.getElementById('shutters').append(shutter);
  }
  const c = timing.cues,
    tl = gsap.timeline({ paused: true });
  const scenes = [
    'footage',
    'rhythm',
    'studio',
    'tools',
    'local',
    'make',
    'brand',
  ];
  gsap.set('.scene', { autoAlpha: 0 });
  gsap.set('#footage', { autoAlpha: 1 });
  scenes.forEach((name, i) => {
    if (i > 0)
      tl.fromTo(
        `#${name}`,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.001 },
        c[name] - 0.001,
      );
    if (i < scenes.length - 1)
      tl.set(`#${name}`, { autoAlpha: 0 }, c[scenes[i + 1]]);
  });
  tl.fromTo(
    '#footage .huge',
    { y: 160, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.72, ease: 'expo.out' },
    0.12,
  )
    .fromTo(
      '#footage .eyebrow,#footage .sub',
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.5, stagger: 0.1 },
      0.25,
    )
    .fromTo(
      '.cutline',
      { scaleX: 0 },
      { scaleX: 1, duration: 0.75, ease: 'expo.inOut' },
      0.65,
    )
    .fromTo(
      '.cutmark',
      { x: -1500 },
      { x: 450, duration: 0.9, ease: 'power3.inOut' },
      0.72,
    )
    .fromTo(
      '#footage .huge',
      { x: 0 },
      { x: -80, duration: 0.3, ease: 'power3.in', immediateRender: false },
      c.rhythm - 0.3,
    )
    .fromTo(
      '#rhythm .huge',
      { y: 100, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.55, ease: 'expo.out' },
      c.rhythm,
    )
    .fromTo(
      '.strip',
      { y: 460, rotation: 8 },
      {
        y: 0,
        rotation: 0,
        duration: 0.72,
        stagger: 0.09,
        ease: 'expo.out',
      },
      c.rhythm + 0.12,
    )
    .fromTo(
      '#rhythm .sub',
      { opacity: 0 },
      { opacity: 1, duration: 0.3 },
      c.rhythm + 0.85,
    )
    .fromTo(
      '.strip img',
      { scale: 1.2 },
      { scale: 1, duration: 1.7, ease: 'sine.out' },
      c.rhythm,
    )
    .fromTo(
      '.strip',
      { y: 0 },
      {
        y: -65,
        stagger: 0.04,
        duration: 0.28,
        ease: 'power2.in',
        immediateRender: false,
      },
      c.studio - 0.3,
    )
    .fromTo(
      '.studio-title',
      { y: 45, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out' },
      c.studio + 0.05,
    )
    .fromTo(
      '.screen',
      { scale: 0.72, rotationX: 12, y: 150, opacity: 0 },
      {
        scale: 0.78,
        rotationX: 0,
        y: 0,
        opacity: 1,
        duration: 0.8,
        ease: 'expo.out',
      },
      c.studio,
    )
    .fromTo(
      '.screen',
      { scale: 0.78, y: 0 },
      {
        scale: 0.82,
        y: -10,
        duration: 2.6,
        ease: 'sine.inOut',
        immediateRender: false,
      },
      c.studio + 0.85,
    )
    .fromTo(
      '.studio-foot',
      { opacity: 0 },
      { opacity: 1, duration: 0.35 },
      c.studio + 0.7,
    )
    .fromTo(
      '.tools-title',
      { x: -120, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' },
      c.tools,
    )
    .fromTo(
      '.track',
      { x: 1700 },
      { x: 0, duration: 0.7, stagger: 0.1, ease: 'expo.out' },
      c.tools + 0.05,
    )
    .fromTo(
      '.playhead',
      { x: -470 },
      { x: 1140, duration: 1.7, ease: 'none' },
      c.tools + 0.12,
    )
    .fromTo(
      '#local .huge',
      { y: 100, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.55, ease: 'expo.out' },
      c.local,
    )
    .fromTo(
      '.local-icon',
      { scale: 0, rotation: -35 },
      { scale: 1, rotation: 0, duration: 0.65, ease: 'back.out(1.4)' },
      c.local + 0.15,
    )
    .fromTo(
      '.local-orbit',
      { scale: 1.5, opacity: 0 },
      {
        scale: 1,
        opacity: 1,
        duration: 0.9,
        stagger: 0.12,
        ease: 'expo.out',
      },
      c.local,
    )
    .fromTo(
      '.satellite',
      { y: -80, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5 },
      c.local + 0.2,
    )
    .fromTo(
      '.satellite',
      { rotation: 0 },
      { rotation: 90, duration: 1.2, immediateRender: false },
      c.local + 0.6,
    )
    .fromTo(
      '.shutter',
      { y: (i) => (i % 2 ? 1080 : -1080) },
      { y: 0, duration: 0.65, stagger: 0.055, ease: 'expo.out' },
      c.make,
    )
    .fromTo(
      '.make-title',
      { scale: 0.8, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.65, ease: 'expo.out' },
      c.make + 0.28,
    )
    .fromTo(
      '.make-title',
      { scale: 1 },
      {
        scale: 1.06,
        duration: 0.9,
        ease: 'sine.inOut',
        immediateRender: false,
      },
      c.make + 0.95,
    )
    .fromTo(
      '.lockup',
      { y: 75, opacity: 0, scale: 0.94 },
      { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out' },
      c.brand,
    )
    .fromTo(
      '.tagline,.url',
      { y: 25, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.45, stagger: 0.13 },
      c.brand + 0.35,
    )
    .fromTo(
      '#progress',
      { scaleX: 0 },
      { scaleX: 1, duration: timing.duration, ease: 'none' },
      0,
    );
  window.__timelines.film = tl;
  window.seek = (t) => {
    tl.totalTime(Math.max(0, Math.min(timing.duration, t)), true);
  };
  window.seek(0);
})();
