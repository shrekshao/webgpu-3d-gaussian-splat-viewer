import './style.css'
import init from './gaussian-splat-app';
import { assert } from './utils/util';
import { Pane } from 'tweakpane';

(async () => {
  if (navigator.gpu === undefined) {
    const h = document.querySelector('#title') as HTMLElement;
    h.innerText = 'WebGPU is not supported in this browser.';
    return;
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (adapter === null) {
    const h = document.querySelector('#title') as HTMLElement;
    h.innerText = 'No adapter is available for WebGPU.';
    return;
  }
  const device = await adapter.requestDevice();

  const canvas = document.querySelector<HTMLCanvasElement>('#webgpu-canvas');
  assert(canvas !== null);
  const context = canvas.getContext('webgpu') as GPUCanvasContext;

  // const data = parse(fetch('/scenes/bicycle/bicycle_30000.cleaned.ply'), PLYLoader).then(ply => {
  //   console.log(ply.header);
  // });

  // Your WebGPU code can go here:
  init(canvas, context, device);
})();