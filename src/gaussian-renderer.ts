import { create_camera_uniform_buffer, update_camera_uniform } from './camera';
import { PointCloud } from './point-cloud';
import proprocess_wgsl from './shaders/preprocess.wgsl';
import render_wgsl from './shaders/gaussian.wgsl';
import { get_sorter } from './sort';

const c_size_render_settings_buffer = 20 * Uint32Array.BYTES_PER_ELEMENT;

export default function get_renderer(pc: PointCloud, device: GPUDevice, presentation_format: GPUTextureFormat) {
  // ===============================================
  //                 preprocess
  // ===============================================
  const preprocess_shader = device.createShaderModule({code: proprocess_wgsl});
  const preprocess_pipeline = device.createComputePipeline({
    label: 'preprocess',
    layout: 'auto',
    compute: {
      module: preprocess_shader,
      entryPoint: 'preprocess',
    },
  });

  const preprocess_bind_group = device.createBindGroup({
    label: 'preprocess',
    // layout: device.createBindGroupLayout({
    //   label: 'preprocess',
    //   entries: [
    //     { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
    //     { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
    //     { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
    //   ]
    // }),
    layout: preprocess_pipeline.getBindGroupLayout(1),
    entries: [
      {
        binding: 0,
        resource: { buffer: pc.gaussian_3d_buffer },
      },
      {
        binding: 1,
        resource: { buffer: pc.sh_buffer },
      },
      {
        binding: 2,
        resource: { buffer: pc.splat_2d_buffer },
      },
    ]
  });

  const camera_buffer = create_camera_uniform_buffer(device);
  // update_camera_uniform(camera, camera_buffer, device);

  const camera_bind_group = device.createBindGroup({
    label: 'camera',
    layout: preprocess_pipeline.getBindGroupLayout(0),
    entries: [{binding: 0, resource: { buffer: camera_buffer }}],
  });

  const sorter = get_sorter(pc.num_points, device);

  const sort_bind_group = device.createBindGroup({
    label: 'sort',
    layout: preprocess_pipeline.getBindGroupLayout(2),
    entries: [
      {binding: 0, resource: { buffer: sorter.sort_info_buffer }},
      {binding: 1, resource: { buffer: sorter.ping_pong[0].sort_depths_buffer }},
      {binding: 2, resource: { buffer: sorter.ping_pong[0].sort_indices_buffer }},
      {binding: 3, resource: { buffer: sorter.sort_dispatch_indirect_buffer }},
    ],
  });


  // TODO: write buffer, on update tweakpane
  const render_settings_buffer = device.createBuffer({
    label: 'render settings',
    size: c_size_render_settings_buffer,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const render_settings_array_buffer = new ArrayBuffer(c_size_render_settings_buffer);
  const view = new DataView(render_settings_array_buffer);
  view.setFloat32(8 * 4, 1.0); // gausian_scaling
  view.setUint32(9 * 4, 0); // show_env_map
  view.setUint32(10 * 4, 0); // mip_spatting
  view.setFloat32(11 * 4, 0); // kernel_size
  view.setFloat32(12 * 4, 0); // walltime
  view.setFloat32(13 * 4, 0); // scene_extend
  
  device.queue.writeBuffer(render_settings_buffer, 0, render_settings_array_buffer);

  const render_settings_bind_group = device.createBindGroup({
    label: 'render settings',
    layout: preprocess_pipeline.getBindGroupLayout(3),
    entries: [{binding: 0, resource: { buffer: render_settings_buffer }}], // uniform
  });

  const preprocess = (encoder: GPUCommandEncoder) => {
    const pass = encoder.beginComputePass({ label: 'preprocess' });
    pass.setPipeline(preprocess_pipeline);
    pass.setBindGroup(0, camera_bind_group);
    pass.setBindGroup(1, preprocess_bind_group);
    pass.setBindGroup(2, sort_bind_group);
    pass.setBindGroup(3, render_settings_bind_group);

    const x = Math.floor((pc.num_points + 255) / 256);  // TEMP
    pass.dispatchWorkgroups(x);
    pass.end();

    // TODO: copy buffer to buffer (sortInfo keys_size to draw indirect vertex_count)
    encoder.copyBufferToBuffer(
      sorter.sort_info_buffer,
      0,
      draw_indirect_buffer,
      4,
      4
    );
  };

  // ===============================================
  //                   sort
  // ===============================================
  const sort = (encoder: GPUCommandEncoder) => {
  };


  // ===============================================
  //                  render
  // ===============================================
  const render_shader = device.createShaderModule({code: render_wgsl});
  const render_pipeline = device.createRenderPipeline({
    label: 'render',
    layout: 'auto',
    vertex: {
      module: render_shader,
      entryPoint: 'vs_main',
    },
    fragment: {
      module: render_shader,
      entryPoint: 'fs_main',
      targets: [{ format: presentation_format }],
    }
  });

  const render_splats_bind_group = device.createBindGroup({
    label: 'gaussian splats rendering',
    // layout: device.createBindGroupLayout({
    //   label: 'gaussian splat rendering',
    //   entries: [{
    //     binding: 2,
    //     visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
    //     buffer: { type: 'storage' },
    //   }],
    // }),
    layout: render_pipeline.getBindGroupLayout(0),
    entries: [{binding: 2, resource: { buffer: pc.splat_2d_buffer }}],
  });

  const render_indices_bind_group = device.createBindGroup({
    label: 'gaussian splats indices',
    layout: render_pipeline.getBindGroupLayout(1),
    entries: [
      {binding: 4, resource: { buffer: sorter.ping_pong[0].sort_indices_buffer }},
    ],
  });

  const draw_indirect_buffer = device.createBuffer({
    label: 'draw indirect',
    size: 4 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.INDIRECT,
  });


  const render = (encoder: GPUCommandEncoder, texture_view: GPUTextureView) => {
    const pass = encoder.beginRenderPass({
      label: 'render',
      colorAttachments: [
        {
          view: texture_view,
          loadOp: 'clear',
          storeOp: 'store',
        }
      ],
    });
    pass.setPipeline(render_pipeline);
    pass.setBindGroup(0, render_splats_bind_group);
    pass.setBindGroup(1, render_indices_bind_group);

    pass.drawIndirect(draw_indirect_buffer, 0);
    pass.end();
  };

  return {
    preprocess,
    sort,
    render,
  };
}