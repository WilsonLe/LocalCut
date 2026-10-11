/* global AudioContext, OffscreenCanvas, File, indexedDB, navigator, localStorage, window, StorageEvent, requestAnimationFrame, document, innerHeight, innerWidth */
// Self-contained functions run inside the real Safari production page via WebDriver.
export async function textFonts(base, namespace) {
  const { createEditor } = await import(base + 'editor.js');
  const editor = await createEditor({ namespace });
  const canvas = new OffscreenCanvas(640, 360),
    ctx = canvas.getContext('2d');
  const styles = [
    { text: 'Xin chào Việt Nam', fontSize: 52, fontFamily: 'font-inter' },
    {
      text: 'Hello world',
      fontSize: 88,
      fontFamily: 'font-special-elite',
      animation: { kind: 'typewriter', stepMs: 40, loop: false },
    },
    {
      text: 'Handmade',
      fontSize: 52,
      fontFamily: 'font-patrick-hand',
      animation: {
        kind: 'handmade',
        stepMs: 50,
        loop: true,
        variations: ['one', 'two', 'three', 'four', 'five'],
      },
    },
  ];
  const pixels = async (id, time) => {
    const frame = await editor.preview.frame(id, time).completion;
    try {
      ctx.drawImage(frame.image, 0, 0);
      return ctx.getImageData(0, 0, 640, 360).data;
    } finally {
      frame.image.close();
    }
  };
  let artifact;
  try {
    const project = await editor.projects.create('Safari animated fonts', {
      width: 640,
      height: 360,
    });
    await editor.commands.apply({
      projectId: project.id,
      expectedRevision: 0,
      requestId: 'fonts',
      operations: [
        { type: 'addTrack', track: { id: 'overlay', kind: 'overlay' } },
        ...styles.map((text, i) => ({
          type: 'insertClip',
          trackId: 'overlay',
          clip: {
            id: 'font-' + i,
            kind: 'text',
            startUs: i * 200000,
            durationUs: 200000,
            x: 40,
            y: 70,
            width: 560,
            height: 260,
            text,
          },
        })),
      ],
    });
    const expected = [];
    for (let i = 0; i < styles.length; i++)
      expected.push(await pixels(project.id, i * 200000 + 100000));
    artifact = await editor.exports.start(project.id, { format: 'mp4' })
      .completion;
    const asset = await editor.assets.import(
      new File([artifact.file], 'font-animation.mp4', { type: 'video/mp4' }),
    ).completion;
    const decoded = await editor.projects.create('Safari decoded fonts', {
      width: 640,
      height: 360,
    });
    await editor.commands.apply({
      projectId: decoded.id,
      expectedRevision: 0,
      requestId: 'decode',
      operations: [
        { type: 'addTrack', track: { id: 'video', kind: 'video' } },
        {
          type: 'insertClip',
          trackId: 'video',
          clip: {
            id: 'decoded',
            kind: 'video',
            assetId: asset.id,
            startUs: 0,
            durationUs: asset.durationUs,
            sourceOutUs: asset.durationUs,
            width: 640,
            height: 360,
          },
        },
      ],
    });
    const errors = [];
    const lit = [];
    for (let i = 0; i < styles.length; i++) {
      const actual = await pixels(decoded.id, i * 200000 + 100000);
      let error = 0,
        count = 0;
      for (let j = 0; j < actual.length; j++) {
        if (j % 4 !== 3) error += Math.abs(actual[j] - expected[i][j]);
        if (
          j % 4 === 0 &&
          expected[i][j] + expected[i][j + 1] + expected[i][j + 2] > 60
        )
          count++;
      }
      errors.push(error / (640 * 360 * 3));
      lit.push(count);
    }
    return { errors, lit, bytes: artifact.file.size };
  } finally {
    await artifact?.dispose();
    await editor.dispose();
  }
}

export async function mediaRoundTrip(base, namespace) {
  const { createEditor } = await import(base + 'editor.js');
  const editor = await createEditor({ namespace });
  const audio = new AudioContext({ sampleRate: 48000 });
  const artifacts = [];
  try {
    const canvas = new OffscreenCanvas(128, 128),
      context = canvas.getContext('2d');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 128, 128);
    const image = await editor.assets.import(
      new File([await canvas.convertToBlob()], 'red.png', {
        type: 'image/png',
      }),
    ).completion;
    const data = new ArrayBuffer(44 + 48000 * 4),
      view = new DataView(data);
    const text = (offset, value) => {
      for (let i = 0; i < value.length; i++)
        view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, data.byteLength - 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, 48000, true);
    view.setUint32(28, 192000, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, data.byteLength - 44, true);
    for (let i = 0; i < 48000; i++) {
      const t = i / 48000;
      view.setInt16(
        44 + i * 4,
        t < 0.2 ? 0 : Math.round(0.3 * Math.sin(2 * Math.PI * 440 * t) * 32767),
        true,
      );
      view.setInt16(
        46 + i * 4,
        t < 0.2
          ? 0
          : Math.round(0.15 * Math.sin(2 * Math.PI * 880 * t) * 32767),
        true,
      );
    }
    const tone = await editor.assets.import(
      new File([data], 'stereo.wav', { type: 'audio/wav' }),
    ).completion;
    const assemble = async (name, video, sound) => {
      const project = await editor.projects.create(name, {
        width: 128,
        height: 128,
      });
      const operations = [
        { type: 'addTrack', track: { id: 'v', kind: 'video' } },
        {
          type: 'insertClip',
          trackId: 'v',
          clip: {
            id: 'v1',
            kind: video.kind === 'image' ? 'image' : 'video',
            ...(video.kind === 'image'
              ? {}
              : { sourceInUs: 0, sourceOutUs: 1000000 }),
            assetId: video.id,
            startUs: 0,
            durationUs: 1000000,
            width: 128,
            height: 128,
          },
        },
      ];
      if (sound)
        operations.push(
          { type: 'addTrack', track: { id: 'a', kind: 'audio' } },
          {
            type: 'insertClip',
            trackId: 'a',
            clip: {
              id: 'a1',
              kind: 'audio',
              assetId: sound.id,
              startUs: 0,
              durationUs: 1000000,
              sourceOutUs: 1000000,
            },
          },
        );
      await editor.commands.apply({
        projectId: project.id,
        requestId: 'assemble',
        expectedRevision: 0,
        operations,
      });
      return project;
    };
    const measurements = [];
    let encoded;
    for (const mode of ['wav', 'aac-reimport', 'silent']) {
      const project = await assemble(
        mode,
        image,
        mode === 'silent' ? undefined : mode === 'wav' ? tone : encoded,
      );
      const caps = await editor.exports.preflight(project.id, { format: 'mp4' })
        .completion;
      if (!caps.supported)
        throw new Error(
          'Required Safari H.264/AAC capability missing: ' +
            JSON.stringify(caps),
        );
      const artifact = await editor.exports.start(project.id, { format: 'mp4' })
        .completion;
      artifacts.push(artifact);
      encoded = await editor.assets.import(
        new File([artifact.file], mode + '.mp4', { type: 'video/mp4' }),
      ).completion;
      const decoded = await assemble('decode-' + mode, encoded);
      const frame = await editor.preview.frame(decoded.id, 500000).completion;
      let pixel;
      try {
        context.drawImage(frame.image, 0, 0);
        pixel = [...context.getImageData(64, 64, 1, 1).data];
      } finally {
        frame.image.close();
      }
      const buffer = await audio.decodeAudioData(
        await artifact.file.arrayBuffer(),
      );
      const rms = (channel) => {
        const samples = buffer.getChannelData(channel),
          from = Math.round(buffer.sampleRate * 0.4),
          to = Math.round(buffer.sampleRate * 0.8);
        let sum = 0;
        for (let i = from; i < to; i++) sum += samples[i] ** 2;
        return Math.sqrt(sum / (to - from));
      };
      const samples = buffer.getChannelData(0);
      const onset =
        samples.findIndex((sample) => Math.abs(sample) > 0.03) /
        buffer.sampleRate;
      measurements.push({
        mode,
        bytes: artifact.file.size,
        videoCodec: encoded.videoCodec,
        audioCodec: encoded.audioCodec,
        durationUs: encoded.durationUs,
        pixel,
        channels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate,
        rms: [rms(0), rms(1)],
        onset,
      });
    }
    const project = await editor.projects.create('Safari reload', {
      width: 128,
      height: 128,
    });
    await editor.commands.apply({
      projectId: project.id,
      requestId: 'track',
      expectedRevision: 0,
      operations: [
        { type: 'addTrack', track: { id: 'persisted', kind: 'video' } },
      ],
    });
    return { measurements, projectId: project.id };
  } finally {
    for (const artifact of artifacts) await artifact.dispose();
    await editor.dispose();
    await audio.close();
  }
}
export async function reopen(base, namespace, id) {
  const { createEditor } = await import(base + 'editor.js');
  const editor = await createEditor({ namespace });
  try {
    const project = await editor.projects.open(id);
    return {
      revision: project.revision,
      tracks: project.tracks.map((track) => track.id),
    };
  } finally {
    await editor.dispose();
  }
}
export async function cleanup(namespace) {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(namespace + '-v1');
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Safari test database is still open'));
  });
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(namespace, { recursive: true });
  } catch (error) {
    if (error.name !== 'NotFoundError') throw error;
  }
}

// Layout metrics use real Safari CSS zoom, including all body-level portal surfaces.
export async function interfaceLayout() {
  // Navigation completion precedes the lazily loaded workspace modules.
  const readyDeadline = Date.now() + 15000;
  while (
    !document.querySelector('.timeline-toolbar') ||
    !document.querySelector('.preview-frame')
  ) {
    if (Date.now() > readyDeadline)
      throw new Error(
        'Workspace did not become ready for Safari layout verification',
      );
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  const key = 'localcut.appearance.v1';
  const before = localStorage.getItem(key);
  const measurements = [];
  try {
    for (const [size, scale] of [
      ['default', 1],
      ['small', 0.75],
      ['large', 1.25],
    ]) {
      const value = JSON.stringify({
        version: 1,
        preferences: { interfaceSize: size },
      });
      localStorage.setItem(key, value);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key,
          newValue: value,
          storageArea: localStorage,
        }),
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const timeline = document
        .querySelector('.timeline')
        .getBoundingClientRect();
      const editor = document
        .querySelector('.editing-area')
        .getBoundingClientRect();
      const header = document
        .querySelector('.workspace-header')
        .getBoundingClientRect();
      measurements.push({
        size,
        scale,
        gap: Math.abs(timeline.bottom - editor.bottom),
        headerHeight: header.height,
        viewportHeight: innerHeight,
        workspaceHeight: document
          .querySelector('.workspace')
          .getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth - innerWidth,
      });
    }
    return measurements;
  } finally {
    if (before === null) localStorage.removeItem(key);
    else localStorage.setItem(key, before);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key,
        newValue: before,
        storageArea: localStorage,
      }),
    );
  }
}
