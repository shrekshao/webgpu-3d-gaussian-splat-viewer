struct CameraUniforms {
    view: mat4x4<f32>,
    view_inv: mat4x4<f32>,
    proj: mat4x4<f32>,
    proj_inv: mat4x4<f32>,
    
    viewport: vec2<f32>,
    focal: vec2<f32>
};

struct Gaussian {
    // (3+1)x f16 packed as u32
    pos_opacity: array<u32,2>,
    // 6x f16 sparse cov matrix
    cov: array<u32,3>
}

@group(0) @binding(0)
var<uniform> camera: CameraUniforms;

@group(1) @binding(0)
var<storage,read> gaussians : array<Gaussian>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(
    @builtin(vertex_index) in_vertex_index: u32,
) -> VertexOutput {
    var out: VertexOutput;

    let vertex = gaussians[in_vertex_index];
    let a = unpack2x16float(vertex.pos_opacity[0]);
    let b = unpack2x16float(vertex.pos_opacity[1]);
    let xyz = vec3<f32>(a.x, a.y, b.x);
    // var opacity = b.y;

    var camspace = camera.view * vec4<f32>(xyz, 1.);
    let pos2d = camera.proj * camspace;
    // let bounds = 1.2 * pos2d.w;
    // let z = pos2d.z / pos2d.w;

    out.position = pos2d;
    // out.position = pos2d / pos2d.w;
    // out.position = vec4<f32>(xyz, 1.);

    return out;
}

// @vertex
// fn vs_main(
//     @builtin(vertex_index) in_vertex_index: u32,
// ) -> VertexOutput {
//     var out: VertexOutput;

//     let vertex = gaussians[in_vertex_index];
//     let a = unpack2x16float(vertex.pos_opacity[0]);
//     let b = unpack2x16float(vertex.pos_opacity[1]);
//     let xyz = vec3<f32>(a.x, a.y, b.x);
//     var camspace = camera.view * vec4<f32>(xyz, 1.);
//     let pos2d = camera.proj * camspace;
//     _ = pos2d;

//     let x = in_vertex_index % 100u;
//     let y = in_vertex_index / 100u;

//     let pos = vec4f( f32(x) * 0.01, f32(y) * 0.01, 0. , 1.);
//     out.position = pos;

//     return out;
// }

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(1., 1., 0., 1.);
}