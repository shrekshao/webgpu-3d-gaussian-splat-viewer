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

let canvas: HTMLCanvasElement;
let fovY = 45 / 180 * Math.PI;   // magic number
let focal = 1;
let fovX = 45 / 180 * Math.PI;
const viewport = vec2.create();

export function on_update_canvas_size() {
  focal = 0.5 * canvas.height / Math.tan(fovY * 0.5);
  fovX = focal2fov(focal, canvas.width);
  viewport[0] = canvas.width;
  viewport[1] = canvas.height;
  const viewport_ratio = canvas.width / canvas.height;
}

export function set_canvas(c: HTMLCanvasElement) {
  canvas = c;
  on_update_canvas_size();
}

function focal2fov(focal: number, pixels: number): number {
  return 2 * Math.atan(pixels / (2 * focal));
}

function fov2focal(fov: number, pixels: number): number {
  return pixels / (2 * Math.tan(fov * 0.5));
}

function get_view_matrix(r: Mat3, t: Vec3): Mat4 {
  const cam_to_world = mat4.fromMat3(r);
  // if (mat3.determinant(r) < 0) {
  //   cam_to_world[0] = -cam_to_world[0];
  //   cam_to_world[5] = -cam_to_world[5];
  //   cam_to_world[10] = -cam_to_world[10];
  // }
  const minus_t = vec3.mulScalar(t, -1);
  mat4.translate(cam_to_world, minus_t, cam_to_world);
  return cam_to_world;
  // const rt = mat4.fromMat3(r);
  // mat4.translate(rt, t, rt);
  // mat4.inverse(rt, rt);
  // mat4.transpose(rt, rt);
  // return rt;
}

// // temp
// const canvasW = 960;
// const canvasH = 960;

function get_projection_matrix(znear: number, zfar: number, fov_x: number, fov_y: number) {
  // return mat4.perspective(fov_y, 1, znear, zfar);

  const tan_half_fov_y = Math.tan(fov_y / 2.);
  const tan_half_fov_x = Math.tan(fov_x / 2.);

  const top = tan_half_fov_y * znear;
  const bottom = -top;
  const right = tan_half_fov_x * znear;
  const left = -right;

  const p = mat4.create();
  p[0] = 2.0 * znear / (right - left);
  // p[5] = 2.0 * znear / (top - bottom);
  p[5] = -2.0 * znear / (top - bottom);   // flip Y
  p[2] = (right + left) / (right - left);
  p[6] = (top + bottom) / (top - bottom);
  p[14] = 1.;
  p[10] = zfar / (zfar - znear);
  p[11] = -(zfar * znear) / (zfar - znear);
  mat4.transpose(p, p);
  
  // p[0] = 2.0 * znear / (right - left);
  // p[5] = 2.0 * znear / (top - bottom);
  // p[8] = (right + left) / (right - left);
  // p[9] = (top + bottom) / (top - bottom);
  // p[10] = zfar / (zfar - znear);
  // p[11] = -(zfar * znear) / (zfar - znear);
  // p[14] = 1.;
  // mat4.transpose(p, p);
  return p;
}

interface Camera {
  position: Vec3,
  rotation: Mat3,
}

export async function load_camera_presets(url: string): Promise<Camera[]> {
  log(`loading scene camera file... : ${url}`);
  const response = await fetch(url);
  const json = await response.json();
  log(`loaded cameras count: ${json.length}`);

  return json.map((j: CameraJson): Camera => {
    const position = vec3.clone(j.position);
    const rotation = mat3.create(...j.rotation.flat());

    return {
      position,
      rotation,
      // view_matrix: view_matrix,
      // view_inv_matrix: mat4.inverse(view_matrix),
      // proj_matrix: proj_matrix,
      // proj_inv_matrix: mat4.inverse(proj_matrix),
      // focal: vec2.create(focal, focal),

      // // set later based on canvas size
      // viewport: vec2.create(canvas.width, canvas.height),   // canvas width, height temp
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

const intermediate_float_32_array = new Float32Array(c_size_camera_uniform / Float32Array.BYTES_PER_ELEMENT);

export function update_camera_uniform(camera: Camera, buffer: GPUBuffer, device: GPUDevice) {
  let offset = 0;

  const view_matrix = get_view_matrix(camera.rotation, camera.position);
  const proj_matrix = get_projection_matrix(0.01, 100, fovX, fovY);

  intermediate_float_32_array.set(view_matrix, offset);
  offset += 16;
  intermediate_float_32_array.set(mat4.inverse(view_matrix), offset);
  offset += 16;
  intermediate_float_32_array.set(proj_matrix, offset);
  offset += 16;
  intermediate_float_32_array.set(mat4.inverse(proj_matrix), offset);
  offset += 16;
  intermediate_float_32_array.set(viewport, offset);
  offset += 2;
  intermediate_float_32_array.set(vec2.create(focal, focal), offset);
  offset += 2;

  // console.log(camera);
  // console.log(intermediate_float_32_array);
  // console.log(camera.focal);
  // console.log(camera.focal2);
  
  device.queue.writeBuffer(buffer, 0, intermediate_float_32_array);
}