// Note: You can import your separate WGSL shader files like this.

// import fragWGSL from './shaders/red.frag.wgsl';

import { load } from './point-cloud';
import { Pane } from 'tweakpane';
import { default as get_renderer_gaussian } from './gaussian-renderer';
import { default as get_renderer_pointcloud } from './point-cloud-renderer';
import { Camera, load_camera_presets } from './camera';
import { CameraControl } from './camera-control';

export interface Renderer {
  frame: (encoder: GPUCommandEncoder, texture_view: GPUTextureView) => void,
  camera_buffer: GPUBuffer,
}

export default async function init(
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  device: GPUDevice
) {
  const camera = new Camera(canvas, device);
  const control = new CameraControl(camera);

  const observer = new ResizeObserver(() => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    camera.on_update_canvas();
  });
  observer.observe(canvas);

  const presentation_format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentation_format,
    alphaMode: 'opaque',
  });

  // const url_base = '/scenes/bicycle';
  // const url_model = `${url_base}/bicycle_30000.cleaned.ply`;
  const url_base = '/scenes/bonsai';
  const url_model = `${url_base}/bonsai_30000.ply`;
  const cameras = await load_camera_presets(`${url_base}/cameras.json`);
  camera.set_preset(cameras[0]);

  // Tweakpane: easily adding tweak control for parameters.
  const params = {
    gaussian_scaling: 1,
    renderer: 'gaussian',
  };

  const pane = new Pane({
    title: 'Config',
    expanded: true,
  });
  pane.addInput(params, 'renderer', {
    options: {
      pointcloud: 'pointcloud',
      gaussian: 'gaussian',
    }
  }).on('change', (e) => {
    renderer = renderers[e.value];
  });
  {
    const intermediate_gaussian_scale = new Float32Array([1]);
    pane.addInput(
      params,
      'gaussian_scaling',
      {min: 0, max: 1}
    ).on('change', (e) => {
      intermediate_gaussian_scale[0] = e.value;
      device.queue.writeBuffer(gaussian_renderer.render_settings_buffer, 8 * 4, intermediate_gaussian_scale);
    });
  }

  const pc = await load(url_model, device);

  // // TEMP TEST: skipping long-time loading
  // const num_points = 1063091;
  // const pc = {
  //   num_points: num_points,
  //   gaussian_3d_buffer: device.createBuffer({size: num_points * 20, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE }),
  //   sh_buffer: device.createBuffer({size: 96, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE }),
  //   splat_2d_buffer: device.createBuffer({size: num_points * 20, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE }),
  // };

  const pointcloud_renderer = get_renderer_pointcloud(pc, device, presentation_format, camera.uniform_buffer);
  const gaussian_renderer = get_renderer_gaussian(pc, device, presentation_format, camera.uniform_buffer);
  const renderers = {
    pointcloud: pointcloud_renderer,
    gaussian: gaussian_renderer,
  };

  let renderer: Renderer = renderers[params.renderer];

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
        console.log(`set to camera preset ${i}`);
        camera.set_preset(cameras[i]);
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
