import type { Page } from '@playwright/test';
import {
  Input,
  BlobSource,
  WEBM,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Output,
  WebMOutputFormat,
  BufferTarget,
} from 'mediabunny';

/** Native Chrome recording, optionally remuxed to retain a delayed first frame. */
export async function mediaVideo(page: Page, start = 0) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 72;
    const draw = () => {
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, 128, 72);
    };
    draw();
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('Recording failed'));
    });
    recorder.start();
    const timer = setInterval(draw, 30);
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      recorder.stop();
      await stopped;
      return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
    } finally {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
    }
  });
  const input = new Input({
    formats: [WEBM],
    source: new BlobSource(new Blob([new Uint8Array(bytes)])),
  });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    const config = (await track.getDecoderConfig())!;
    const source = new EncodedVideoPacketSource(track.codec!);
    const target = new BufferTarget();
    const output = new Output({ format: new WebMOutputFormat(), target });
    output.addVideoTrack(source);
    await output.start();
    for await (const packet of new EncodedPacketSink(track).packets()) {
      await source.add(packet.clone({ timestamp: packet.timestamp + start }), {
        decoderConfig: config,
      });
    }
    source.close();
    await output.finalize();
    return {
      name: start ? 'delayed.webm' : 'green.webm',
      mimeType: 'video/webm',
      buffer: Buffer.from(target.buffer!),
    };
  } finally {
    input.dispose();
  }
}
