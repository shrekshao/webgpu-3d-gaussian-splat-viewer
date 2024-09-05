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

export function set_canvas(c: HTMLCanvasElement) {
  canvas = c;
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
  p[5] = -2.0 * znear / (top - bottom);
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

export async function load_camera_presets(url: string): Promise<CameraUniform[]> {
  log(`loading scene camera file... : ${url}`);
  const response = await fetch(url);
  const json = await response.json();
  log(`loaded cameras count: ${json.length}`);

  return json.map((j: CameraJson): CameraUniform => {
    const position = vec3.clone(j.position);
    const rotation = mat3.create(...j.rotation.flat());
    // const rotation = mat3.create(
    //   j.rotation[0][0],
    //   j.rotation[0][1],
    //   j.rotation[0][2],
    //   j.rotation[1][0],
    //   j.rotation[1][1],
    //   j.rotation[1][2],
    //   j.rotation[2][0],
    //   j.rotation[2][1],
    //   j.rotation[2][2],
    // );
    const view_matrix = get_view_matrix(rotation, position);

    // const proj_matrix = mat4.perspective(j.fy, 1, 0.2, 1000);
    // const proj_matrix = mat4.perspective(Math.PI / 3, 1, 0.2, 1000);
    // const proj_matrix = mat4.identity();

    // const fovFactor = 1;
    // const fovFactor = 2;
    // const fovX = focal2fov(canvas.width / 2, canvas.width) / fovFactor;
    // const fovY = -focal2fov(canvas.height, canvas.height) / fovFactor;
    // const fovX = focal2fov(j.fx, canvas.width);
    // const fovY = focal2fov(j.fy, canvas.height);

    // const fovX = 45 / 180 * Math.PI;
    const fovY = 45 / 180 * Math.PI;   // magic set
    // const focal = 0.5 * j.fy / Math.tan(fovY * 0.5);
    // const fovX = focal2fov(focal, j.fx);
    const focal = 0.5 * canvas.height / Math.tan(fovY * 0.5);
    const fovX = focal2fov(focal, canvas.width);

    const proj_matrix = get_projection_matrix(0.01, 100, fovX, fovY);
    // const proj_matrix = get_projection_matrix(0.1, 1000, Math.PI / 3 * 2, Math.PI / 3);

    const viewport_ratio = canvas.width / canvas.height;

    return {
      view_matrix: view_matrix,
      view_inv_matrix: mat4.inverse(view_matrix),
      proj_matrix: proj_matrix,
      proj_inv_matrix: mat4.inverse(proj_matrix),
      focal: vec2.create(focal, focal),
      // focal: vec2.create(fov2focal(fovX, canvas.width), fov2focal(fovY, canvas.height)),
      // focal2: vec2.create(focal, focal),

      // set later based on canvas size
      viewport: vec2.create(canvas.width, canvas.height),   // canvas width, height temp
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

  // console.log(camera);
  // console.log(intermediate_float_32_array);
  // console.log(camera.focal);
  // console.log(camera.focal2);
  
  device.queue.writeBuffer(buffer, 0, intermediate_float_32_array);
}