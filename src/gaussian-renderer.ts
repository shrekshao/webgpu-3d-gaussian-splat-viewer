import { PointCloud } from './point-cloud';
import proprocess_wgsl from './shaders/preprocess.wgsl';

export default function getRenderer(pc: PointCloud, device: GPUDevice) {
  const preprocess_shader = device.createShaderModule({code: proprocess_wgsl});
  const preprocess_pipeline = device.createComputePipeline({
    label: 'preprocess',
    layout: 'auto',
    compute: {
      module: preprocess_shader,
      entryPoint: 'preprocess',
    },
  });

  // preprocess
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

  const render_bind_group = device.createBindGroup({
    label: 'gaussian splats rendering',
    layout: device.createBindGroupLayout({
      label: 'gaussian splat rendering',
      entries: [{
        binding: 2,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      }],
    }),
    // layout: preprocess_pipeline.getBindGroupLayout(2),
    entries: [{binding: 2, resource: { buffer: pc.splat_2d_buffer }}],
  });


  const camera_bind_group = device.createBindGroup({
    label: 'camera',
    layout: preprocess_pipeline.getBindGroupLayout(0),
    entries: [{binding: 0, resource: { buffer:  }}],
  });

  return {
    preprocess: (encoder: GPUCommandEncoder) => {
      const pass = encoder.beginComputePass({ label: 'preprocess' });
      pass.setPipeline(preprocess_pipeline);
      pass.setBindGroup(0, camera_bind_group);
      pass.setBindGroup(1, preprocess_bind_group);
      pass.setBindGroup(2, sort_bind_group);
      pass.setBindGroup(3, render_settings_bind_group);

      const x = Math.floor((pc.num_points + 255) / 256);
      pass.dispatchWorkgroups(x);
    },
  };
}