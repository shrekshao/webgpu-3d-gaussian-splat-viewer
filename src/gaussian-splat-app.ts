// Note: You can import your separate WGSL shader files like this.

// import fragWGSL from './shaders/red.frag.wgsl';


import {PLYLoader} from '@loaders.gl/ply';
import { load, PointCloud } from './point-cloud';
import { Pane } from 'tweakpane';
// import get_renderer from './gaussian-renderer';
import get_renderer from './point-cloud-renderer';
import { load_camera_presets, set_canvas, update_camera_uniform } from './camera';

export default async function init(
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  device: GPUDevice
) {
  const observer = new ResizeObserver(() => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    // Note: You might want to add logic to resize your render target textures here.
  });
  observer.observe(canvas);
  set_canvas(canvas);



  const presentation_format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentation_format,
    alphaMode: 'opaque',
  });

  // Tweakpane: easily adding tweak control for parameters.
  const params = {
    gaussian_scaling: 1,
  };

  const pane = new Pane({
    title: 'Config',
    expanded: true,
  });

  pane.addInput(params, 'gaussian_scaling', {min: 0, max: 1});

  const url_base = '/scenes/bicycle';

  
  const camera = await load_camera_presets(`${url_base}/cameras.json`);
  console.log(camera[0]);

  const pc = await load(`${url_base}/bicycle_30000.cleaned.ply`, device);

  // const renderer = get_renderer(pc, device, presentation_format);
  // update_camera_uniform(camera[0], renderer.camera_buffer, device);

  // function frame() {
  //   const encoder = device.createCommandEncoder();
  //   const texture_view = context.getCurrentTexture().createView();
  //   renderer.preprocess(encoder);
  //   renderer.sort(encoder);
  //   renderer.render(encoder, texture_view);
  //   device.queue.submit([encoder.finish()]);
  //   requestAnimationFrame(frame);
  // }

  // requestAnimationFrame(frame);

  document.addEventListener('keydown', (event) => {
    switch(event.key) {
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
        const i = parseInt(event.key);
        const c = camera[i];
        console.log(`set to camera preset ${i}`);
        console.log(c);
        update_camera_uniform(c, renderer.camera_buffer, device);
        break;
    }
  });

  const renderer = get_renderer(pc, device, presentation_format);
  update_camera_uniform(camera[0], renderer.camera_buffer, device);
  function frame() {
    const encoder = device.createCommandEncoder();
    const texture_view = context.getCurrentTexture().createView();
    renderer.frame(encoder, texture_view);
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
