/* global window, document, gsap, fetch */
window.__timelines = window.__timelines || {};
window.motionReady = (async () => {
  const timing = await (await fetch('timeline.json')).json();
  await document.fonts.ready;
  await Promise.all([...document.images].map((image) => image.decode()));
  for (let i = 0; i < 87; i++) {
    const bar = document.createElement('i');
    bar.className = 'bar';
    bar.style.height = `${8 + 77 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.31))}px`;
    document.getElementById('waveform').append(bar);
  }
  const c = timing.cues,
    tl = gsap.timeline({ paused: true });
  const scenes = Object.keys(c).filter((name) => name !== 'end');
  gsap.set('.scene', { autoAlpha: 0 });
  gsap.set('#footage', { autoAlpha: 1 });
  scenes.forEach((name, i) => {
    if (i)
      tl.fromTo(
        '#' + name,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.001 },
        c[name] - 0.001,
      );
    if (i < scenes.length - 1)
      tl.set('#' + name, { autoAlpha: 0 }, c[scenes[i + 1]]);
    if (document.querySelector('#' + name + ' h2'))
      tl.fromTo(
        '#' + name + ' h2',
        { y: 45, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, ease: 'expo.out' },
        c[name],
      );
    if (document.querySelector('#' + name + ' .eyebrow'))
      tl.fromTo(
        '#' + name + ' .eyebrow',
        { opacity: 0 },
        { opacity: 1, duration: 0.25 },
        c[name],
      );
  });
  tl.fromTo(
    '#footage h1',
    { y: 110, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out' },
    0.04,
  )
    .fromTo(
      '.intro-mark',
      { rotation: -20, scale: 0.7, opacity: 0 },
      { rotation: 0, scale: 1, opacity: 1, duration: 0.65, ease: 'expo.out' },
      0.1,
    )
    .fromTo(
      '.cutline',
      { scaleX: 0 },
      { scaleX: 1, duration: 0.4, ease: 'expo.inOut' },
      0.4,
    )
    .fromTo('.sub', { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.3)
    .fromTo(
      '.media-ui',
      { y: 90, scale: 0.96, opacity: 0 },
      { y: 0, scale: 1, opacity: 1, duration: 0.5, ease: 'expo.out' },
      c.media,
    )
    .fromTo(
      '.media-stack img',
      { x: 400, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.5, stagger: 0.075, ease: 'expo.out' },
      c.media + 0.05,
    )
    .fromTo(
      '.media-chips span',
      { y: 25, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.3, stagger: 0.06 },
      c.media + 0.5,
    )
    .fromTo(
      '.index-shot',
      { y: 65, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.45, ease: 'expo.out' },
      c.index,
    )
    .fromTo(
      '.index-copy',
      { x: 80, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' },
      c.index + 0.08,
    )
    .fromTo(
      '.tag-row span',
      { y: 20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.35, stagger: 0.09 },
      c.index + 0.5,
    )
    .fromTo(
      '.scanline',
      { y: 0, opacity: 0.5 },
      { y: 600, opacity: 0, duration: 1.3, ease: 'none' },
      c.index + 0.15,
    )
    .fromTo(
      '.chat-shot',
      { x: 140, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' },
      c.chat,
    )
    .fromTo(
      '.chat-copy h3,.request',
      { y: 45, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4, stagger: 0.1, ease: 'expo.out' },
      c.chat + 0.05,
    )
    .fromTo(
      '.chat-copy .chips span',
      { opacity: 0 },
      { opacity: 1, duration: 0.3, stagger: 0.06 },
      c.chat + 0.5,
    )
    .fromTo(
      '.grade-result',
      { scale: 1.08, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.45, ease: 'expo.out' },
      c.color,
    )
    .fromTo(
      '.grade-split',
      { clipPath: 'inset(0 0 0 100%)' },
      { clipPath: 'inset(0 0 0 15%)', duration: 1.5, ease: 'power2.inOut' },
      c.color + 0.1,
    )
    .fromTo(
      '.control-card',
      { y: 80, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: 'expo.out' },
      c.color + 0.05,
    )
    .fromTo(
      '.mask-result,.mask-shot',
      { y: 60, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: 'expo.out' },
      c.motion,
    )
    .fromTo(
      '.mask-window,.tracking-box',
      { x: 0 },
      { x: 240, duration: 1.8, ease: 'sine.inOut' },
      c.motion,
    )
    .fromTo(
      '.motion-grid>div',
      { y: 35, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.35, stagger: 0.075, ease: 'expo.out' },
      c.motion + 0.25,
    )
    .fromTo(
      '.audio-shot',
      { x: -80, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' },
      c.audio,
    )
    .fromTo(
      '.eq>div',
      { y: 55, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.45, stagger: 0.08, ease: 'expo.out' },
      c.audio + 0.05,
    )
    .fromTo(
      '.eq i',
      { scaleY: 0.7 },
      { scaleY: 1, duration: 0.7, stagger: 0.12, ease: 'back.out(2)' },
      c.audio + 0.2,
    )
    .fromTo(
      '.bar',
      { scaleY: 0.15 },
      {
        scaleY: 1,
        duration: 0.5,
        stagger: { each: 0.009, from: 'center' },
        ease: 'expo.out',
      },
      c.audio + 0.2,
    )
    .fromTo(
      '.sound-playhead',
      { x: 0 },
      { x: 860, duration: 2.4, ease: 'none' },
      c.audio + 0.2,
    )
    .fromTo(
      '.ramp',
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.4 },
      c.audio + 0.55,
    )
    .fromTo(
      '.audio-features span',
      { y: 20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.3, stagger: 0.04 },
      c.audio + 0.4,
    )
    .fromTo(
      '.lockup',
      { scale: 0.86, y: 65, opacity: 0 },
      { scale: 1, y: 0, opacity: 1, duration: 0.7, ease: 'expo.out' },
      c.brand,
    )
    .fromTo(
      '.tagline,.brand-features,.url',
      { y: 25, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.45, stagger: 0.1 },
      c.brand + 0.3,
    )
    .fromTo(
      '#progress',
      { scaleX: 0 },
      { scaleX: 1, duration: timing.duration, ease: 'none' },
      0,
    );
  window.__timelines.film = tl;
  window.seek = (t) => {
    tl.totalTime(Math.min(timing.duration, Math.max(0, t)), true);
  };
})();
