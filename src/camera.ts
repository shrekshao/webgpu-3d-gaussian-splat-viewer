import { Mat3, mat3, Mat4, mat4, quatn, Vec3, vec3, Vec2, vec2 } from 'wgpu-matrix';
import { log, time, timeLog } from './utils/simple-console';

interface CameraJson {
  id: number
  img_name: string
  width: number
  height: number
  position: number[]
  rotation: number[][]
  fx: number
  fy: number
};

// type CameraPreset = {
//   position: Vec3,
//   rotation: Mat3,
// };

function focal2fov(focal: number, pixels: number): number {
  return 2 * Math.atan(pixels / (2 * focal))
}

function get_view_matrix(r: Mat3, t: Vec3): Mat4 {
  const cam_to_world = mat4.fromMat3(r);
  const minus_t = vec3.mulScalar(t, -1);
  mat4.translate(cam_to_world, minus_t, cam_to_world);
  return cam_to_world;
}

export async function load_camera_presets(url: string): Promise<CameraUniform[]> {
  log(`loading scene camera file... : ${url}`);
  const response = await fetch(url);
  const json = await response.json();
  log(`loaded cameras count: ${json.length}`);

  // // const presets: {position: vec3, rotation: mat3} = 
  // return json.map((j: CameraJson) => {
  //     return {
  //       position: vec3.clone(j.position),
  //       // rotation: mat3n.clone(j.rotation.flat()),
  //       rotation: mat3.create(
  //         j.rotation[0][0],
  //         j.rotation[0][1],
  //         j.rotation[0][2],
  //         j.rotation[1][0],
  //         j.rotation[1][1],
  //         j.rotation[1][2],
  //         j.rotation[2][0],
  //         j.rotation[2][1],
  //         j.rotation[2][2],
  //       ),
  //     };
  //     // fy:,
  //     // fx:,
  //   });

  return json.map((j: CameraJson) => {
    const position = vec3.clone(j.position);
    const rotation = mat3.create(
      j.rotation[0][0],
      j.rotation[0][1],
      j.rotation[0][2],
      j.rotation[1][0],
      j.rotation[1][1],
      j.rotation[1][2],
      j.rotation[2][0],
      j.rotation[2][1],
      j.rotation[2][2],
    );
    const view_matrix = get_view_matrix(rotation, position);

    const proj_matrix = mat4.perspective(j.fy, 1, 0.2, 1000);

    return {
      view_matrix: view_matrix,
      view_inv_matrix: mat4.inverse(view_matrix),
      proj_matrix: proj_matrix,
      proj_inv_matrix: mat4.inverse(proj_matrix),
      focal: vec2.create(j.fx, j.fy),

      // set later based on canvas size
      viewport: vec2.create(960, 960),   // canvas width, height temp
    };
  });
}


const c_size_vec2 = 4 * 2;
const c_size_mat4 = 4 * 16; // byte size of mat4 (i.e. Float32Array(16))
const c_size_camera_uniform = 4 * c_size_mat4 + 2 * c_size_vec2;
interface CameraUniform {
  view_matrix: Mat4,
  view_inv_matrix: Mat4,
  proj_matrix: Mat4,
  proj_inv_matrix: Mat4,

  viewport: Vec2,
  focal: Vec2,
}

export function create_camera_uniform_buffer(device: GPUDevice) {
  return device.createBuffer({
    label: 'camera uniform',
    size: c_size_camera_uniform,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

const intermediate_float_32_array = new Float32Array(c_size_camera_uniform / 4);

export function update_camera_uniform(camera: CameraUniform, buffer: GPUBuffer, device: GPUDevice) {
  let offset = 0;

  intermediate_float_32_array.set(camera.view_matrix, offset);
  offset += 16;
  intermediate_float_32_array.set(camera.view_inv_matrix, offset);
  offset += 16;
  intermediate_float_32_array.set(camera.proj_matrix, offset);
  offset += 16;
  intermediate_float_32_array.set(camera.proj_inv_matrix, offset);
  offset += 16;
  intermediate_float_32_array.set(camera.viewport, offset);
  offset += 2;
  intermediate_float_32_array.set(camera.focal, offset);
  offset += 2;
  
  device.queue.writeBuffer(buffer, 0, intermediate_float_32_array);
}