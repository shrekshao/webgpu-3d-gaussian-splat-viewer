import { PointCloud } from './point-cloud';
import proprocess_wgsl from './shaders/preprocess.wgsl';
import render_wgsl from './shaders/gaussian.wgsl';
import { get_sorter } from './sort';
import { Renderer } from './gaussian-splat-app';

export interface GaussianRenderer extends Renderer {
  render_settings_buffer: GPUBuffer,
}

const c_size_render_settings_buffer = 20 * Uint32Array.BYTES_PER_ELEMENT;

const c_workgroup_size_preprocess = 256;

export default function get_renderer(
  pc: PointCloud,
  device: GPUDevice,
  presentation_format: GPUTextureFormat,
  camera_buffer: GPUBuffer,
): GaussianRenderer {
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
  const nulling_data = new Uint32Array([0]);

  const render_settings_buffer = device.createBuffer({
    label: 'render settings',
    size: c_size_render_settings_buffer,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const render_settings_array_buffer = new ArrayBuffer(c_size_render_settings_buffer);
  const view = new DataView(render_settings_array_buffer);
  // Pitfalls: Typed Arrays use little-endian
  view.setFloat32(8 * 4, 1.0, true); // gausian_scaling
  view.setUint32(9 * 4, 3, true); // max_sh_deg
  view.setUint32(10 * 4, 0, true); // show_env_map
  view.setUint32(11 * 4, 0, true); // mip_splatting
  view.setFloat32(12 * 4, 0.3, true); // kernel_size
  view.setFloat32(13 * 4, 0, true); // walltime
  view.setFloat32(14 * 4, 0, true); // scene_extend
  
  device.queue.writeBuffer(render_settings_buffer, 0, render_settings_array_buffer);

  const render_settings_bind_group = device.createBindGroup({
    label: 'render settings',
    layout: preprocess_pipeline.getBindGroupLayout(3),
    entries: [{binding: 0, resource: { buffer: render_settings_buffer }}], // uniform
  });

  const preprocess_workgroup_count = Math.floor((pc.num_points + c_workgroup_size_preprocess - 1) / c_workgroup_size_preprocess);

  const preprocess = (encoder: GPUCommandEncoder) => {
    // write buffer nulling
    device.queue.writeBuffer(sorter.sort_info_buffer, 0, nulling_data);
    device.queue.writeBuffer(sorter.sort_dispatch_indirect_buffer, 0, nulling_data);

    const pass = encoder.beginComputePass({ label: 'preprocess' });
    pass.setPipeline(preprocess_pipeline);
    pass.setBindGroup(0, camera_bind_group);
    pass.setBindGroup(1, preprocess_bind_group);
    pass.setBindGroup(2, sort_bind_group);
    pass.setBindGroup(3, render_settings_bind_group);
    pass.dispatchWorkgroups(preprocess_workgroup_count);
    pass.end();
    
    encoder.copyBufferToBuffer(
      sorter.sort_info_buffer,
      0,
      draw_indirect_buffer,
      Uint32Array.BYTES_PER_ELEMENT * 1,
      Uint32Array.BYTES_PER_ELEMENT
    );
  };

  // ===============================================
  //                   sort
  // ===============================================
  const sort = (encoder: GPUCommandEncoder) => {
    sorter.sort(encoder);
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
      targets: [{
        format: presentation_format,
        // premultiplied alpha blending
        // (1 * src) + ((1 - src_alpha) * dst)
        blend: {
          color: {
            operation: 'add',
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
          },
          alpha: {
            operation: 'add',
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
          },
        },
      }],
    },
    primitive: {
      topology: 'triangle-strip',
      cullMode: 'none', // temp
    },
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
  device.queue.writeBuffer(draw_indirect_buffer, 0, new Uint32Array([4, 0, 0, 0]));
  // device.queue.writeBuffer(draw_indirect_buffer, 0, new Uint32Array([4, 3000, 0, 0]));  // temp test
  // device.queue.writeBuffer(draw_indirect_buffer, 0, new Uint32Array([4, Math.floor(pc.num_points * 0.5) , 0, 0]));  // temp test

  const render = (encoder: GPUCommandEncoder, texture_view: GPUTextureView) => {

    const pass = encoder.beginRenderPass({
      label: 'render',
      colorAttachments: [
        {
          view: texture_view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0]
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
    frame: (encoder: GPUCommandEncoder, texture_view: GPUTextureView) => {
      preprocess(encoder);
      sort(encoder);
      render(encoder, texture_view);
    },

    camera_buffer,
    render_settings_buffer,
  };
}