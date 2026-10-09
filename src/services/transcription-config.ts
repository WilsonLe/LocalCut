export const MODEL = 'Xenova/whisper-tiny';
export const MODEL_REVISION = '5332fcc35e32a33b86612b9a57a89be7906102b1';
export const RUNTIME_VERSION = '1.31.0-dev.20260914-8d85527a0';
export const RUNTIME_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${RUNTIME_VERSION}/dist`;
export const modelFiles = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];
export const runtimeFiles = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];
export const modelHashes: Record<string, string> = {
  'encoder_model_quantized.onnx':
    'fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e',
  'decoder_model_merged_quantized.onnx':
    '6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0',
};
export const runtimeHashes: Record<string, string> = {
  'ort-wasm-simd-threaded.asyncify.mjs':
    '0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611',
  'ort-wasm-simd-threaded.asyncify.wasm':
    '49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082',
};
export function requiredUrls() {
  return [
    ...modelFiles.map(
      (f) => `https://huggingface.co/${MODEL}/resolve/${MODEL_REVISION}/${f}`,
    ),
    ...runtimeFiles.map((f) => `${RUNTIME_CDN}/${f}`),
  ];
}
