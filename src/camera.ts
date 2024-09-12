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

interface CameraPreset {
  position: Vec3,
  rotation: Mat3,
}

export async function load_camera_presets(url: string): Promise<CameraPreset[]> {
  log(`loading scene camera file... : ${url}`);
  const response = await fetch(url);
  const json = await response.json();
  log(`loaded cameras count: ${json.length}`);

  return json.map((j: CameraJson): CameraPreset => {
    const position = vec3.clone(j.position);
    const rotation = mat3.create(...j.rotation.flat());

    return {
      position,
      rotation,
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

export class Camera {
  constructor(
    public readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
  ) {
    this.uniform_buffer = create_camera_uniform_buffer(device);
    this.on_update_canvas();
  }

  on_update_canvas(): void {
    const focal = 0.5 * this.canvas.height / Math.tan(this.fovY * 0.5);
    this.focal[0] = focal;
    this.focal[1] = focal;
    this.fovX = focal2fov(focal, this.canvas.width);
    this.viewport[0] = this.canvas.width;
    this.viewport[1] = this.canvas.height;
    // const viewport_ratio = this.canvas.width / this.canvas.height;
  }
  
  readonly uniform_buffer: GPUBuffer;
  
  private position: Vec3 = vec3.create();
  private rotation: Mat3 = mat3.create();
  private fovY: number = 45 / 180 * Math.PI;
  private fovX: number;
  private focal: Vec2 = vec2.create();
  private viewport: Vec2 = vec2.create();

  private view_matrix: Mat4 = mat4.identity();
  private proj_matrix: Mat4 = mat4.identity();

  update_buffer(): void {
    let offset = 0;

    this.view_matrix = get_view_matrix(this.rotation, this.position);
    this.proj_matrix = get_projection_matrix(0.01, 100, this.fovX, this.fovY);

    intermediate_float_32_array.set(this.view_matrix, offset);
    offset += 16;
    intermediate_float_32_array.set(mat4.inverse(this.view_matrix), offset);
    offset += 16;
    intermediate_float_32_array.set(this.proj_matrix, offset);
    offset += 16;
    intermediate_float_32_array.set(mat4.inverse(this.proj_matrix), offset);
    offset += 16;
    intermediate_float_32_array.set(this.viewport, offset);
    offset += 2;
    intermediate_float_32_array.set(this.focal, offset);
    offset += 2;

    this.device.queue.writeBuffer(this.uniform_buffer, 0, intermediate_float_32_array);
  }
  set_preset(preset: CameraPreset): void {
    this.position = preset.position;
    this.rotation = preset.rotation;
    this.update_buffer();
  }

};

// export function create_camera(device: GPUDevice): Camera {

//   return {
//     camera_buffer: create_camera_uniform_buffer(device),
//   }
// }