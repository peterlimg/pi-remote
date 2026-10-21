// Three throwaway image treatments, not provider architecture diagrams.
async function renderAssembly() {
  const canvas = document.querySelector('#A canvas');
  const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL is required to render the assembly prototype.');
  const vertex = 'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';
  const fragment = `
precision highp float;
uniform vec2 resolution;
mat2 rotate(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
float roundedBox(vec3 p,vec3 size,float r){vec3 q=abs(p)-size+r;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.)-r;}
vec2 scene(vec3 p){
  vec3 q=p;q.xz=rotate(-.23)*q.xz;
  float pi=roundedBox(q-vec3(0.,.05,0.),vec3(1.08,.23,.34),.11);
  pi=min(pi,roundedBox(q-vec3(-.67,-.62,0.),vec3(.24,.72,.32),.11));
  pi=min(pi,roundedBox(q-vec3(.67,-.62,0.),vec3(.24,.72,.32),.11));
  vec3 star=q-vec3(-.02,1.67,0.);star.xy=rotate(.12)*star.xy;
  float claude=100.;
  for(int i=0;i<11;i++){
    vec3 arm=star;arm.xy=rotate(float(i)*6.2831853/11.)*arm.xy;
    claude=min(claude,roundedBox(arm-vec3(.39,0.,0.),vec3(.48,.105,.17),.075));
  }
  vec2 hit=pi<claude?vec2(pi,1.):vec2(claude,2.);
  float floorDistance=p.y+1.35;
  if(floorDistance<hit.x)hit=vec2(floorDistance,0.);
  return hit;
}
vec3 normalAt(vec3 p){vec2 e=vec2(.001,0.);return normalize(vec3(scene(p+e.xyy).x-scene(p-e.xyy).x,scene(p+e.yxy).x-scene(p-e.yxy).x,scene(p+e.yyx).x-scene(p-e.yyx).x));}
float occlusion(vec3 p,vec3 n){float a=0.;float scale=1.;for(int i=1;i<6;i++){float d=.055*float(i);a+=(d-scene(p+n*d).x)*scale;scale*=.7;}return clamp(1.-a*2.8,0.,1.);}
float shadow(vec3 p,vec3 l){float shade=1.;float t=.04;for(int i=0;i<35;i++){float h=scene(p+l*t).x;shade=min(shade,12.*h/t);t+=clamp(h,.03,.3);if(t>7.)break;}return clamp(shade,.12,1.);}
void main(){
  vec2 uv=(gl_FragCoord.xy-resolution*vec2(.76,.51))/resolution.y;
  vec3 ro=vec3(3.5,2.5,7.);vec3 target=vec3(0.,.45,0.);
  vec3 ww=normalize(target-ro),uu=normalize(cross(ww,vec3(0.,1.,0.))),vv=cross(uu,ww);
  vec3 rd=normalize(uv.x*uu+uv.y*vv+1.8*ww);
  float t=0.;vec2 hit=vec2(0.);bool found=false;
  for(int i=0;i<115;i++){hit=scene(ro+rd*t);if(hit.x<.0015){found=true;break;}t+=hit.x*.85;if(t>30.)break;}
  vec3 color=vec3(.071,.16,.153);
  if(found){
    vec3 p=ro+rd*t,n=normalAt(p),light=normalize(vec3(-3.,6.,5.));
    float ao=occlusion(p,n),shade=shadow(p+n*.015,light),diff=max(dot(n,light),0.);
    vec3 base=hit.y<.5?vec3(.071,.16,.153):(hit.y<1.5?vec3(.1,.63,.4):vec3(.96,.34,.18));
    color=base*(.31+.7*diff*shade)*ao;
    float spec=pow(max(dot(n,normalize(light-rd)),0.),38.);
    color+=vec3(.88,.94,.82)*spec*.42*shade;
    color+=base*pow(1.-max(dot(n,-rd),0.),3.)*.24;
    color+=vec3(.04,.1,.13)*max(dot(n,normalize(vec3(4.,2.,-3.))),0.)*.45;
    if(hit.y<.5)color=mix(vec3(.071,.16,.153),color,exp(-.035*dot(p.xz,p.xz)));
  }
  color=pow(max(color,0.),vec3(.86));
  gl_FragColor=vec4(color,1.);
}`;
  const shader = (type, source) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(gl.getUniformLocation(program, 'resolution'), canvas.width, canvas.height);
  gl.viewport(0, 0, canvas.width, canvas.height); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.finish();
}

function renderScreenprint() {
  const canvas = document.querySelector('#C canvas');
  const ctx = canvas.getContext('2d');
  let seed = 819;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const mask = document.createElement('canvas'); mask.width = 1200; mask.height = 600;
  const m = mask.getContext('2d');
  m.font = '800 265px Bricolage'; m.fillText('Pi', 739, 404);
  const pixels = m.getImageData(0, 0, 1200, 600).data;
  // A mathematical print, with a dense irregular field cut away into the actual Pi letterforms.
  ctx.fillStyle = '#221c28';
  for (let y = 32; y < 532; y += 4.5) {
    for (let x = 612; x < 1170; x += 4.5) {
      const dx = x - 890, dy = (y - 287) * 1.05;
      const angle = Math.atan2(dy, dx);
      const radius = Math.hypot(dx, dy);
      const edge = 205 + 30 * Math.cos(angle * 9 + .9) + 13 * Math.cos(angle * 5 - .4);
      const ink = pixels[(Math.floor(y) * 1200 + Math.floor(x)) * 4 + 3] > 100;
      if (radius > edge || ink) continue;
      const wave = Math.sin(radius * .14 + Math.sin(angle * 3) * 7 + dx * .013);
      const size = (.6 + (wave + 1) * .58) * (.7 + random() * .6);
      ctx.beginPath(); ctx.arc(x + (random() - .5), y + (random() - .5), size, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.strokeStyle = '#221c28'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(623, 504); ctx.lineTo(1150, 504); ctx.stroke();
}

(async () => {
  await document.fonts.load('800 265px Bricolage');
  await document.fonts.load('700 89px Bricolage');
  await renderAssembly(); renderScreenprint();
  window.__coversReady = true;
})().catch(error => { window.__coversError = error.message; throw error; });
