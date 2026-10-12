import RAPIER from '@dimforge/rapier3d-compat'; await RAPIER.init();
const w=new RAPIER.World({x:0,y:-9.81,z:0}); w.timestep=1/120;
w.createCollider(RAPIER.ColliderDesc.cuboid(500,0.5,500).setTranslation(0,-0.5,0));
const b=w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,0.6,0).setCanSleep(false));
w.createCollider(RAPIER.ColliderDesc.cuboid(0.8,0.2,2).setMass(650),b);
const v=w.createVehicleController(b);
for(const p of [[-0.8,0,-1.3],[0.8,0,-1.3],[-0.8,0,1.25],[0.8,0,1.25]]) v.addWheel({x:p[0],y:p[1],z:p[2]},{x:0,y:-1,z:0},{x:1,y:0,z:0},0.12,0.33);
for(let i=0;i<4;i++){v.setWheelSuspensionStiffness(i,60);v.setWheelFrictionSlip(i,2.2);}
for(let k=0;k<240;k++){v.setWheelEngineForce(2,2000);v.setWheelEngineForce(3,2000);v.updateVehicle(1/120);w.step();}
console.log([0,1,2,3].map(i=>v.wheelRotation(i).toFixed(1)).join(' '));
