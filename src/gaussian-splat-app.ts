// Note: You can import your separate WGSL shader files like this.

// import fragWGSL from './shaders/red.frag.wgsl';


import {PLYLoader} from '@loaders.gl/ply';
import { load, PointCloud } from './point-cloud';
import { Pane } from 'tweakpane';
import { default as get_renderer_gaussian } from './gaussian-renderer';
import { default as get_renderer_pointcloud } from './point-cloud-renderer';
import { load_camera_presets, on_update_canvas_size, set_canvas, update_camera_uniform } from './camera';

export default async function init(
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  device: GPUDevice
) {
  let initialized = false;
  const observer = new ResizeObserver(() => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    on_update_canvas_size();
    if (initialized) {
      update_camera_uniform(cur_camera, renderer.camera_buffer, device);
    }
  });
  observer.observe(canvas);
  set_canvas(canvas);

  const presentation_format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentation_format,
    alphaMode: 'opaque',
  });

  const url_base = '/scenes/bicycle';
  
  const cameras = await load_camera_presets(`${url_base}/cameras.json`);
  let cur_camera = cameras[0];

  // Tweakpane: easily adding tweak control for parameters.
  const params = {
    gaussian_scaling: 1,
    // renderer: 'pointcloud',
    renderer: 'gaussian',
  };

  const pane = new Pane({
    title: 'Config',
    expanded: true,
  });
  pane.addInput(params, 'gaussian_scaling', {min: 0, max: 1});
  pane.addInput(params, 'renderer', {
    options: {
      pointcloud: 'pointcloud',
      gaussian: 'gaussian',
    }
  }).on('change', (e) => {
    renderer = renderers[e.value];
    update_camera_uniform(cur_camera, renderer.camera_buffer, device);
  });
  
  // console.log(cur_camera);

  const pc = await load(`${url_base}/bicycle_30000.cleaned.ply`, device);

  // // TEMP TEST: skipping long-time loading
  // const num_points = 1063091;
  // const pc = {
  //   num_points: num_points,
  //   gaussian_3d_buffer: device.createBuffer({size: num_points * 20, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE }),
  //   sh_buffer: device.createBuffer({size: 96, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE }),
  //   splat_2d_buffer: device.createBuffer({size: num_points * 20, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE }),
  // };

  const pointcloud_renderer = get_renderer_pointcloud(pc, device, presentation_format);
  const gaussian_renderer = get_renderer_gaussian(pc, device, presentation_format);
  const renderers = {
    pointcloud: pointcloud_renderer,
    gaussian: gaussian_renderer,
  };

  let renderer = renderers[params.renderer];
  update_camera_uniform(cur_camera, pointcloud_renderer.camera_buffer, device);
  update_camera_uniform(cur_camera, gaussian_renderer.camera_buffer, device);

  initialized = true;

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
        cur_camera = cameras[i];
        console.log(`set to camera preset ${i}`);
        // console.log(c);
        update_camera_uniform(cur_camera, renderer.camera_buffer, device);
        break;
    }
  });

  function frame() {
    const encoder = device.createCommandEncoder();
    const texture_view = context.getCurrentTexture().createView();
    renderer.frame(encoder, texture_view);
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
