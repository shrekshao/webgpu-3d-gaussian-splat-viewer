import { parse } from '@loaders.gl/core';
import { PLYLoader } from '@loaders.gl/ply';
import { Float16Array } from '@petamoriken/float16';
import { mat3, Quat, quat, Vec3, vec3 } from 'wgpu-matrix';
import { log, time, timeLog } from './utils/simple-console';
import { sigmoid } from './utils/util';

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

function build_cov(rot: Quat, scale: Vec3): number[] {
  const r = mat3.fromQuat(rot);
  // const s = mat3.scaling(scale); // this is 2d scale
  const s = mat3.identity();
  s[0] = scale[0];
  s[5] = scale[1];
  s[10] = scale[2];
  const l = mat3.mul(r, s);
  const m = mat3.mul(l, mat3.transpose(l));
  // wgpu mat3 has 4x3 elements
  // [m[0][0], m[0][1], m[0][2], m[1][1], m[1][2], m[2][2]]
  return [m[0], m[1], m[2], m[5], m[6], m[10]];
}

export type PointCloud = Awaited<ReturnType<typeof load>>;


export async function load(url: string, device: GPUDevice) {
  log(`loading ply file... : ${url}`);
  time();
  const ply = await parse(fetch(url), PLYLoader);
  timeLog();
  // console.log(ply.loaderData.elements[0].properties);
  // 0: {type: 'float', name: 'x'}
  // 1: {type: 'float', name: 'y'}
  // 2: {type: 'float', name: 'z'}
  // 3: {type: 'float', name: 'nx'}
  // 4: {type: 'float', name: 'ny'}
  // 5: {type: 'float', name: 'nz'}
  // 6: {type: 'float', name: 'f_dc_0'}
  // 7: {type: 'float', name: 'f_dc_1'}
  // 8: {type: 'float', name: 'f_dc_2'}
  // 9: {type: 'float', name: 'f_rest_0'}
  // 10: {type: 'float', name: 'f_rest_1'}
  // 11: {type: 'float', name: 'f_rest_2'}
  // 12: {type: 'float', name: 'f_rest_3'}
  // 13: {type: 'float', name: 'f_rest_4'}
  // 14: {type: 'float', name: 'f_rest_5'}
  // 15: {type: 'float', name: 'f_rest_6'}
  // 16: {type: 'float', name: 'f_rest_7'}
  // 17: {type: 'float', name: 'f_rest_8'}
  // 18: {type: 'float', name: 'f_rest_9'}
  // 19: {type: 'float', name: 'f_rest_10'}
  // 20: {type: 'float', name: 'f_rest_11'}
  // 21: {type: 'float', name: 'f_rest_12'}
  // 22: {type: 'float', name: 'f_rest_13'}
  // 23: {type: 'float', name: 'f_rest_14'}
  // 24: {type: 'float', name: 'f_rest_15'}
  // 25: {type: 'float', name: 'f_rest_16'}
  // 26: {type: 'float', name: 'f_rest_17'}
  // 27: {type: 'float', name: 'f_rest_18'}
  // 28: {type: 'float', name: 'f_rest_19'}
  // 29: {type: 'float', name: 'f_rest_20'}
  // 30: {type: 'float', name: 'f_rest_21'}
  // 31: {type: 'float', name: 'f_rest_22'}
  // 32: {type: 'float', name: 'f_rest_23'}
  // 33: {type: 'float', name: 'f_rest_24'}
  // 34: {type: 'float', name: 'f_rest_25'}
  // 35: {type: 'float', name: 'f_rest_26'}
  // 36: {type: 'float', name: 'f_rest_27'}
  // 37: {type: 'float', name: 'f_rest_28'}
  // 38: {type: 'float', name: 'f_rest_29'}
  // 39: {type: 'float', name: 'f_rest_30'}
  // 40: {type: 'float', name: 'f_rest_31'}
  // 41: {type: 'float', name: 'f_rest_32'}
  // 42: {type: 'float', name: 'f_rest_33'}
  // 43: {type: 'float', name: 'f_rest_34'}
  // 44: {type: 'float', name: 'f_rest_35'}
  // 45: {type: 'float', name: 'f_rest_36'}
  // 46: {type: 'float', name: 'f_rest_37'}
  // 47: {type: 'float', name: 'f_rest_38'}
  // 48: {type: 'float', name: 'f_rest_39'}
  // 49: {type: 'float', name: 'f_rest_40'}
  // 50: {type: 'float', name: 'f_rest_41'}
  // 51: {type: 'float', name: 'f_rest_42'}
  // 52: {type: 'float', name: 'f_rest_43'}
  // 53: {type: 'float', name: 'f_rest_44'}
  // 54: {type: 'float', name: 'opacity'}
  // 55: {type: 'float', name: 'scale_0'}
  // 56: {type: 'float', name: 'scale_1'}
  // 57: {type: 'float', name: 'scale_2'}
  // 58: {type: 'float', name: 'rot_0'}
  // 59: {type: 'float', name: 'rot_1'}
  // 60: {type: 'float', name: 'rot_2'}
  // 61: {type: 'float', name: 'rot_3'}

  // console.log(ply.header);
  // boundingBox: [[], []]
  // vertexCount: 1063091 (= elements[0].vertexCount)
  
  // console.log(ply.attributes);
  // {
  //   NORMAL: { value: Float32Array(3189273), size: 3 },  // nx, ny, nz
  //   POSITION: { value: Float32Array(3189273), size: 3 },  // x, y, z
  //   f_dc_0: { value: Float32Array(1063091), size: 1 },
  //   ...
  //   rot_3: { value: Float32Array(1063091), size: 1 },
  // }

  const num_points = ply.header.vertexCount;

  log(`num points: ${num_points}`);
  log(`processing loaded attributes...`);
  time();


  // xyz (position), opacity, cov (from rot and scale)
  const gaussian_3d_buffer = device.createBuffer({
    label: 'ply input 3d gaussians data buffer',
    size: num_points * c_size_3d_gaussian,  // buffer size multiple of 4?
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    mappedAtCreation: true,
  });
  const position = ply.attributes['POSITION'].value;
  const opacity = ply.attributes['opacity'].value;
  const scale_0 = ply.attributes['scale_0'].value;
  const scale_1 = ply.attributes['scale_1'].value;
  const scale_2 = ply.attributes['scale_2'].value;
  const rot_0 = ply.attributes['rot_0'].value;  // w
  const rot_1 = ply.attributes['rot_1'].value;  // x
  const rot_2 = ply.attributes['rot_2'].value;  // y
  const rot_3 = ply.attributes['rot_3'].value;  // z
  const gaussian = new Float16Array(gaussian_3d_buffer.getMappedRange());
  for (let i = 0; i < num_points; i++) {
    const o = i * (c_size_3d_gaussian / c_size_float);
    const i3 = i * 3;
    // x, y, z position
    gaussian[o + 0] = position[i3];
    gaussian[o + 1] = position[i3+1];
    gaussian[o + 2] = position[i3+2];
    // opacity
    gaussian[o + 3] = sigmoid(opacity[i]);
    // cov, 6x f16
    const rot = quat.create(rot_1[i], rot_2[i], rot_3[i], rot_0[i]);
    quat.normalize(rot, rot);
    // console.log([scale_0[i], scale_1[i], scale_2[i]]);
    const scale = vec3.create(Math.exp(scale_0[i]), Math.exp(scale_1[i]), Math.exp(scale_2[i]));
    const cov = build_cov(rot, scale);
    gaussian.set(cov, o + 4);

    // if (i < 3) {
    //   // console.log(opacity[i]);
    //   // console.log(scale);
    //   // console.log(rot);
    //   console.log(cov);
    // }
  }
  // console.log('---------------');
  // for (let i = 0; i < 30; i++) {
  //   console.log(gaussian.at(i));
  // }
  gaussian_3d_buffer.unmap();

  // Spherical harmonic function coeffs
  const sh_buffer = device.createBuffer({
    label: 'ply input 3d gaussians data buffer',
    size: num_points * c_size_sh_coef,  // buffer size multiple of 4?
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    mappedAtCreation: true,
  });
  const sh = new Float16Array(sh_buffer.getMappedRange());
  // const sh = new Float32Array(sh_buffer.getMappedRange());  // temp test

  // dc_0, dc_1, dc_2, rest_0, rest_1, ...
  const sh_coefs = new Array(num_coefs * 3);
  sh_coefs[0] = ply.attributes['f_dc_0'].value;
  sh_coefs[1] = ply.attributes['f_dc_1'].value;
  sh_coefs[2] = ply.attributes['f_dc_2'].value;
  for (let o = 0; o < 3 * (num_coefs - 1); o++) {
    sh_coefs[3 + o] = ply.attributes[`f_rest_${o}`].value;
  }

  // input: sh_coefs: r1, r2, ..., r15, g1, ..., g15, b1, ..., b15
  // output: sh: r0, g0, b0, r1, g1, b1, ..., r15, g15, b15
  for (let i = 0; i < num_points; i++) {
    const output_offset = i * num_coefs * 3;

    sh[output_offset + 0] = sh_coefs[0][i];
    sh[output_offset + 1] = sh_coefs[1][i];
    sh[output_offset + 2] = sh_coefs[2][i];

    for (let order = 1; order < num_coefs; order++) {
      const order_offset = order * 3;
      for (let c = 0; c < 3; c++) {
        const channel_offset = 3 + (num_coefs - 1) * c + order - 1;
        sh[output_offset + order_offset + c] = sh_coefs[channel_offset][i];
      }
    }
  }
  sh_buffer.unmap();

  const splat_2d_buffer = device.createBuffer({
    label: '2d gaussians buffer',
    size: num_points * c_size_2d_splat,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  });

  

  timeLog();
  

  return {
    num_points: num_points,
    gaussian_3d_buffer,
    sh_buffer,
    splat_2d_buffer,
  };
}

// export default class PointCloud {
//   splat_2d_buffer


//   constructor(url: URL, device: GPUDevice) {
//     // TODO: use web worker
//     const ply = this.loadPLY(url);

//     this.splat_2d_buffer = device.createBuffer({
//       label: 
//     })
//   }


//   async loadPLY(url: URL) {
//     const ply = await parse(fetch('/scenes/bicycle/bicycle_30000.cleaned.ply'), PLYLoader);
//     return ply;
//   }
// }