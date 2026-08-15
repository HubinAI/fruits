import Matter from 'matter-js';
const engine = Matter.Engine.create();
engine.gravity.y = 1;
const ground = Matter.Bodies.rectangle(400, 715, 2000, 50, { isStatic: true, friction: 1 });
Matter.Composite.add(engine.world, ground);
const wheel = Matter.Bodies.circle(400, 660, 20, { density: 0.01, friction: 0.9, frictionStatic: 0.9 });
Matter.Composite.add(engine.world, wheel);

// 每步设置角速度（模拟 motor）
for (let i=0;i<120;i++) {
  Matter.Body.setAngularVelocity(wheel, 31.4);  // 300 RPM
  Matter.Engine.update(engine, 1000/60);
}
console.log('直接设角速度: wheel x =', wheel.position.x.toFixed(1), '(应明显右移), angVel', wheel.angularVelocity.toFixed(1));

// 测试方式2：增量
const w2 = Matter.Bodies.circle(400, 660, 20, { density: 0.01, friction: 0.9 });
Matter.Composite.add(engine.world, w2);
for (let i=0;i<120;i++) {
  Matter.Body.setAngularVelocity(w2, w2.angularVelocity + 0.35);
  Matter.Engine.update(engine, 1000/60);
}
console.log('增量0.35/步: w2 x =', w2.position.x.toFixed(1), 'angVel', w2.angularVelocity.toFixed(1));
