import { RadixSortKernel as radix_sort_kernel } from 'webgpu-radix-sort';
import { PointCloud } from './point-cloud';

export interface SortStuff {
  sort: (encoder: GPUCommandEncoder) => void,

}

export function get_sorter(pc: PointCloud, device: GPUDevice, keys_buffer: GPUBuffer, values_buffer: GPUBuffer): SortStuff {
  // Temp: read back visible key size
  const key_length = pc.num_points;

  // Create radix sort kernel    
  const sorter = new radix_sort_kernel({
    device: device,                   // GPUDevice to use
    keys: keys_buffer,                 // GPUBuffer containing the keys to sort
    values: values_buffer,             // (optional) GPUBuffer containing the associated values
    count: key_length,               // Number of elements to sort
    check_order: false,               // Whether to check if the input is already sorted to exit early
    bit_count: 32,                    // Number of bits per element. Must be a multiple of 4 (default: 32)
    workgroup_size: { x: 16, y: 16 }, // Workgroup size in x and y dimensions. (x * y) must be a power of two
  });


  return {
    sort: (encoder: GPUCommandEncoder) => {
      const pass = encoder.beginComputePass({
        label: 'sort',
      });
      sorter.dispatch(pass);
      pass.end();
    },
  };
}