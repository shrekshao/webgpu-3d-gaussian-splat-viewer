import { Float16Array } from '@petamoriken/float16';
import { log, time, timeLog } from './utils/simple-console';

const c_size_float = 2;   // byte size of f16
// const c_size_float = 4;   // byte size of f32

const c_size_2d_splat = 
  4 * c_size_float  // rotation
  + 2 * c_size_float  // screen space position
  + 4 * c_size_float  // color (calculated by SH)
;

const c_size_3d_gaussian =
  3 * c_size_float  // x y z (position)
  + c_size_float    // opacity
  + 6 * c_size_float  // cov
;

const sh_deg = 3;
const num_coefs = (sh_deg + 1) * (sh_deg + 1);

const c_size_sh_coef = 
  3 * num_coefs * c_size_float // 3 channels (RGB) x 16 coefs
;


export type PointCloud = Awaited<ReturnType<typeof load>>;




export function load(url: string, device: GPUDevice) {
  return new Promise((resolve) => {
    let gaussian_3d_buffer: GPUBuffer;
    let sh_buffer: GPUBuffer;
    let splat_2d_buffer: GPUBuffer;
    let num_points: number;

    const worker = new Worker(new URL('point-cloud-parser-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = function(event: MessageEvent) {
      switch(event.data[0]) {
        case 'log':
          log(event.data[1]);
          break;
        case 'num_points':
          timeLog();

          time();
          num_points = event.data[1];
          gaussian_3d_buffer = device.createBuffer({
            label: 'ply input 3d gaussians data buffer',
            size: num_points * c_size_3d_gaussian,  // buffer size multiple of 4?
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
            mappedAtCreation: true,
          });
          
          sh_buffer = device.createBuffer({
            label: 'ply input 3d gaussians data buffer',
            size: num_points * c_size_sh_coef,  // buffer size multiple of 4?
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
            mappedAtCreation: true,
          });

          splat_2d_buffer = device.createBuffer({
            label: '2d gaussians buffer',
            size: num_points * c_size_2d_splat,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
          });
          
          // TODO: Cannot use SharedArrayBuffer here. has to copy
          worker.postMessage(['parse', gaussian_3d_buffer.getMappedRange(), sh_buffer.getMappedRange()]);
          break;
        case 'finish':
          console.log();
          gaussian_3d_buffer.unmap();
          sh_buffer.unmap();
          
          timeLog();
          resolve({
            num_points: num_points,
            gaussian_3d_buffer,
            sh_buffer,
            splat_2d_buffer,
          })
          break;
      }
    };

    time();
    worker.postMessage(['load', url]);
  });
}
