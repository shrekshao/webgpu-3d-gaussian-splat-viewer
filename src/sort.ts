/*
    This file implements a gpu version of radix sort. A good introduction to general purpose radix sort can
    be found here: http://www.codercorner.com/RadixSortRevisited.htm

    The gpu radix sort implemented here is a reimplementation of the vulkan radix sort found in the fuchsia repos: https://fuchsia.googlesource.com/fuchsia/+/refs/heads/main/src/graphics/lib/compute/radix_sort/
    Currently only the sorting for floating point key-value pairs is implemented, as only this is needed for this project

    All shaders can be found in shaders/radix_sort.wgsl
*/

import radix_sort_wgsl from './shaders/radix_sort.wgsl';
import { align } from './utils/util';

export interface SortStuff {
  sort: (encoder: GPUCommandEncoder) => void,
  sort_info_buffer: GPUBuffer,
  sort_dispatch_indirect_buffer: GPUBuffer,

  // ping-pong
  ping_pong: {
    sort_indices_buffer: GPUBuffer,
    sort_depths_buffer: GPUBuffer,
  }[]
}


function create_ping_pong_buffer(adjusted_count: number, keysize: number, device: GPUDevice) {
  return {
    // payload
    sort_indices_buffer: device.createBuffer({
      label: 'ping pong sort indices',
      size: keysize * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }),
    // key
    sort_depths_buffer: device.createBuffer({
      label: 'ping pong sort depths',
      size: adjusted_count * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }),
  };
}

// // [1, 8, 16, 32]
// const c_histogram_sg_size = 16;
// const c_histogram_workgroup_size = 256;
// const c_radix_log2 = 8;
// const c_radix_size = 1 << c_radix_log2;
// const c_keyval_size = 32 / c_radix_log2;
// const c_histogram_block_rows = 15;
// const c_scatter_block_rows = c_histogram_block_rows;

// 8 bit radices
const c_radix_log2 = 8;
const c_histogram_block_rows = 15;

const C = {
  histogram_sg_size: 32,
  histogram_wg_size: 256,
  rs_radix_log2: 8,
  rs_radix_size: 1 << c_radix_log2,
  rs_keyval_size: 32 / c_radix_log2,
  rs_histogram_block_rows: c_histogram_block_rows,
  rs_scatter_block_rows: c_histogram_block_rows,

  prefix_wg_size: 1 << 7,
  scatter_wg_size: 1 << 8,

  rs_mem_dwords: 0,
};
const c_rs_smem_phase_2 = C.rs_radix_size + C.rs_scatter_block_rows * C.scatter_wg_size;
C.rs_mem_dwords = c_rs_smem_phase_2;

console.log(C);

// const c_size_sort_info = 5 * 4;
function create_pipelines(device: GPUDevice) {
  // storage array length cannot use override, use string concat const instead
  const module = device.createShaderModule({
    label: 'radix sort',
    // code: radix_sort_wgsl,
    code: `const rs_mem_dwords = ${C.rs_mem_dwords}u;
    ${radix_sort_wgsl}
    `
  });

  const bind_group_layout = device.createBindGroupLayout({
    entries: [
      // info
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'storage',
        }
      },
      // histograms
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'storage',
        }
      },
      // keys_a
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'storage',
        }
      },
      // keys_b
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'storage',
        }
      },
      // payload_a
      {
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'storage',
        }
      },
      // payload_b
      {
        binding: 5,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'storage',
        }
      },
    ]
  });

  const pipeline_layout = device.createPipelineLayout({
    label: 'radix sort',
    bindGroupLayouts: [bind_group_layout],
  });

  return {
    bind_group_layout,
    zero: device.createComputePipeline({
      // label: 'zero histograms',
      // layout: 'auto',
      layout: pipeline_layout,
      compute: {
        module: module,
        entryPoint: 'zero_histograms',
        // constants,
      },
    }),
    histogram: device.createComputePipeline({
      layout: pipeline_layout,
      compute: {
        module: module,
        entryPoint: 'calculate_histogram',
        // constants,
      }
    }),
    prefix: device.createComputePipeline({
      layout: pipeline_layout,
      compute: {
        module: module,
        entryPoint: 'prefix_histogram',
        // constants,
      }
    }),
    scatter_odd: device.createComputePipeline({
      layout: pipeline_layout,
      compute: {
        module: module,
        entryPoint: 'scatter_odd',
        // constants,
      }
    }),
    scatter_even: device.createComputePipeline({
      layout: pipeline_layout,
      compute: {
        module: module,
        entryPoint: 'scatter_even',
        // constants,
      }
    }),
  };
};

function get_scatter_histogram_sizes(keysize: number) {
  // as a general rule of thumb, scater_blocks_ru is equal to histo_blocks_ru, except the amount of elements in these two stages is different

  const scatter_block_kvs = C.histogram_wg_size * C.rs_scatter_block_rows;
  const scatter_blocks_ru = Math.floor((keysize + scatter_block_kvs - 1) / scatter_block_kvs);
  const count_ru_scatter = scatter_blocks_ru * scatter_block_kvs;

  const histo_block_kvs = C.histogram_wg_size * C.rs_histogram_block_rows;
  const histo_blocks_ru = Math.floor((count_ru_scatter + histo_block_kvs - 1) / histo_block_kvs);
  const count_ru_histo = histo_blocks_ru * histo_block_kvs;

  return {
      scatter_block_kvs,
      scatter_blocks_ru,
      count_ru_scatter,
      histo_block_kvs,
      histo_blocks_ru,
      count_ru_histo,
  };
}

// caclulates and allocates a buffer that is sufficient for holding all needed information for
// sorting. This includes the histograms and the temporary scatter buffer
function create_histogram_buffer(keysize: number, device: GPUDevice) {
  // currently only a few different key bits are supported, maybe has to be extended
  // assert!(key_bits == 32 || key_bits == 64 || key_bits == 16);

  // subgroup and workgroup sizes
  const histo_sg_size = C.histogram_sg_size;
  const _histo_wg_size = C.histogram_wg_size;
  const _prefix_sg_size = histo_sg_size;
  const _internal_sg_size = histo_sg_size;

  // The "internal" memory map looks like this:
  //   +---------------------------------+ <-- 0
  //   | histograms[keyval_size]         |
  //   +---------------------------------+ <-- keyval_size                           * histo_size
  //   | partitions[scatter_blocks_ru-1] |
  //   +---------------------------------+ <-- (keyval_size + scatter_blocks_ru - 1) * histo_size
  //   | workgroup_ids[keyval_size]      |
  //   +---------------------------------+ <-- (keyval_size + scatter_blocks_ru - 1) * histo_size + workgroup_ids_size

  const { scatter_blocks_ru } = get_scatter_histogram_sizes(keysize);

  const histo_size = C.rs_radix_size * Uint32Array.BYTES_PER_ELEMENT;

  // const internal_size = (C.keyval_size + scatter_blocks_ru - 1 + 1) * histo_size; // +1 safety
  const internal_size = align((C.rs_keyval_size + scatter_blocks_ru - 1 + 1) * histo_size, 4); // +1 safety
  return device.createBuffer({
    label: 'histogram',
    size: internal_size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
}

export function get_sorter(keysize: number, device: GPUDevice): SortStuff {
  // const keys_per_workgroup = C.histogram_wg_size * C.rs_histogram_block_rows;
  // const workgroup_count = (keysize + keys_per_workgroup - 1) / keys_per_workgroup;
  // // const keys_count_adjusted = keys_per_workgroup * workgroup_count;
  // const keys_count_adjusted = 1067520;

  const keys_per_workgroup = C.histogram_wg_size * C.rs_histogram_block_rows;
  const keys_count_adjusted = (Math.floor((keysize + keys_per_workgroup - 1) / keys_per_workgroup) + 1) * keys_per_workgroup;

  console.log(`keys count adjusted: ${keys_count_adjusted}`); // histogram count
  console.log(`key size: ${keysize}`);

  const sort_info_buffer = device.createBuffer({
    label: 'sort info',
    size: 5 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  const sort_dispatch_indirect_buffer = device.createBuffer({
    label: 'sort dispatch indirect',
    size: 3 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDIRECT,
  });

  const pipelines = create_pipelines(device);

  const ping_pong = [
    create_ping_pong_buffer(keys_count_adjusted, keysize, device),
    create_ping_pong_buffer(keys_count_adjusted, keysize, device),
  ];

  const histogram_buffer = create_histogram_buffer(keysize, device);

  
  const { scatter_blocks_ru, count_ru_histo } = get_scatter_histogram_sizes(keysize);
  console.log(scatter_blocks_ru);
  console.log(count_ru_histo);
  device.queue.writeBuffer(sort_info_buffer, 0, new Uint32Array([keysize, count_ru_histo, 4, 0, 0]));
  device.queue.writeBuffer(sort_dispatch_indirect_buffer, 0, new Uint32Array([scatter_blocks_ru, 1, 1]));

  const bind_group = device.createBindGroup({
    label: 'sort',
    layout: pipelines.bind_group_layout,
    entries: [
      { binding: 0, resource: { buffer: sort_info_buffer } },
      { binding: 1, resource: { buffer: histogram_buffer } },
      { binding: 2, resource: { buffer: ping_pong[0].sort_depths_buffer } },
      { binding: 3, resource: { buffer: ping_pong[1].sort_depths_buffer } },
      { binding: 4, resource: { buffer: ping_pong[0].sort_indices_buffer } },
      { binding: 5, resource: { buffer: ping_pong[1].sort_indices_buffer } },
    ]
  });

  function record_calculate_histogram_indirect(encoder: GPUCommandEncoder) {
    {
      const pass = encoder.beginComputePass({
        label: 'zeroing histogram',
      });
      pass.setPipeline(pipelines.zero);
      pass.setBindGroup(0, bind_group);
      pass.dispatchWorkgroupsIndirect(sort_dispatch_indirect_buffer, 0);
      pass.end();
    }
    {
      const pass = encoder.beginComputePass({
        label: 'calculate histogram',
      });
      pass.setPipeline(pipelines.histogram);
      pass.setBindGroup(0, bind_group);
      pass.dispatchWorkgroupsIndirect(sort_dispatch_indirect_buffer, 0);
      pass.end();
    }
  }

  function record_prefix_histogram(encoder: GPUCommandEncoder) {
    const pass = encoder.beginComputePass({
      label: 'prefix histogram',
    });
    pass.setPipeline(pipelines.prefix);
    pass.setBindGroup(0, bind_group);
    pass.dispatchWorkgroups(4); // passes
    pass.end();
  }

  function record_scatter_keys_indirect(encoder: GPUCommandEncoder) {
    const pass = encoder.beginComputePass({
      label: 'scatter keyvals',
    });
    pass.setBindGroup(0, bind_group);

    // assert: passes == 4
    
    pass.setPipeline(pipelines.scatter_even);
    pass.dispatchWorkgroupsIndirect(sort_dispatch_indirect_buffer, 0);
    pass.setPipeline(pipelines.scatter_odd);
    pass.dispatchWorkgroupsIndirect(sort_dispatch_indirect_buffer, 0);
    pass.setPipeline(pipelines.scatter_even);
    pass.dispatchWorkgroupsIndirect(sort_dispatch_indirect_buffer, 0);
    pass.setPipeline(pipelines.scatter_odd);
    pass.dispatchWorkgroupsIndirect(sort_dispatch_indirect_buffer, 0);
    pass.end();
  }

  function sort(encoder: GPUCommandEncoder) {
    record_calculate_histogram_indirect(encoder);
    record_prefix_histogram(encoder);
    record_scatter_keys_indirect(encoder);
  };

  return {
    sort_info_buffer,
    sort_dispatch_indirect_buffer,
    ping_pong,

    sort,
  };
}
