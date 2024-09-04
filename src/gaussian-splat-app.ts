// Note: You can import your separate WGSL shader files like this.

// import fragWGSL from './shaders/red.frag.wgsl';


import {PLYLoader} from '@loaders.gl/ply';
import { load, PointCloud } from './point-cloud';
import { Pane } from 'tweakpane';
import get_renderer from './gaussian-renderer';
import { load_camera_presets } from './camera';

export default async function init(
  context: GPUCanvasContext,
  device: GPUDevice
) {
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

  const renderer = get_renderer(pc, device, presentation_format);

  function frame() {
    const encoder = device.createCommandEncoder();
    const texture_view = context.getCurrentTexture().createView();
    renderer.preprocess(encoder);
    renderer.sort(encoder);
    renderer.render(encoder, texture_view);
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
