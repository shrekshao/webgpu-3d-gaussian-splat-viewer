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
  const observer = new ResizeObserver(() => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    // Note: You might want to add logic to resize your render target textures here.

  });
  observer.observe(canvas);
  const context = canvas.getContext('webgpu') as GPUCanvasContext;

  // const data = parse(fetch('/scenes/bicycle/bicycle_30000.cleaned.ply'), PLYLoader).then(ply => {
  //   console.log(ply.header);
  // });


  // Tweakpane: easily adding tweak control for parameters.
  const PARAMS = {
    level: 0,
    name: 'Test',
    active: true,
  };

  const pane = new Pane({
    title: 'Debug',
    expanded: false,
  });

  pane.addInput(PARAMS, 'level', {min: 0, max: 100});
  pane.addInput(PARAMS, 'name');
  pane.addInput(PARAMS, 'active');

  // Your WebGPU code can go here:
  init(context, device);
})();