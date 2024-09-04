

export interface SortStuff {
  // num_points: number,
  sort_info_buffer: GPUBuffer,
  sort_dispatch_indirect_buffer: GPUBuffer,

  // ping-pong
  ping_pong: {
    sort_indices_buffer: GPUBuffer,
    sort_depths_buffer: GPUBuffer,
  }[]
}


function create_ping_pong_buffer(count: number, device: GPUDevice) {
  return {
    sort_indices_buffer: device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }),
    sort_depths_buffer: device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }),
  };
}

const c_histogram_workgroup_size = 256;
const c_histogram_keys_per_thread = 15;

// const c_size_sort_info = 5 * 4;

export function get_sorter(count: number, device: GPUDevice): SortStuff {
  const keys_per_workgroup = c_histogram_workgroup_size * c_histogram_keys_per_thread;
  const workgroup_count = (count + keys_per_workgroup - 1) / keys_per_workgroup;
  const keys_count_adjusted = keys_per_workgroup * workgroup_count;

  const sort_info_buffer = device.createBuffer({
    size: 5 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  const sort_dispatch_indirect_buffer = device.createBuffer({
    size: 3 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDIRECT,
  });

  return {
    sort_info_buffer,
    sort_dispatch_indirect_buffer,

    ping_pong: [
      create_ping_pong_buffer(keys_count_adjusted, device),
      create_ping_pong_buffer(keys_count_adjusted, device),
    ],
  };
}
