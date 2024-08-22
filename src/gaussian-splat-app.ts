// Note: You can import your separate WGSL shader files like this.

// import fragWGSL from './shaders/red.frag.wgsl';


import {PLYLoader} from '@loaders.gl/ply';
import { load, load_camera, PointCloud } from './point-cloud';

export default async function init(
  context: GPUCanvasContext,
  device: GPUDevice
) {
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'opaque',
  });

  const url_base = '/scenes/bicycle';

  // const pc = await load(`${url_base}/bicycle_30000.cleaned.ply`, device);
  const camera = await load_camera(`${url_base}/cameras.json`);
  console.log(camera[0]);

  // const renderer = ;

  function frame() {
    // renderer.render();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
