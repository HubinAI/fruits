import Matter from 'matter-js';
const engine = Matter.Engine.create();
engine.gravity.y = 1;

const GROUND=0x0001, ARENA=0x0002, VA=0x0004, VB=0x0008, PROJ=0x0010, HAZ=0x0020;

// 模拟 adapter 的 ground 创建
const g = Matter.Bodies.rectangle(800, 1150, 1720, 900, {
  density: 0,
  collisionFilter: { category: GROUND, mask: VA|VB|PROJ, group: 0 },
  friction: 1, frictionStatic: 1,
});
g.isStatic = true;
Matter.Composite.add(engine.world, g);

// 模拟 wheel
const w = Matter.Bodies.circle(600, 660, 20, {
  density: 0.01,
  collisionFilter: { category: VA, mask: GROUND|ARENA|PROJ|HAZ|VB, group: -1 },
  friction: 0.9,
});
Matter.Composite.add(engine.world, w);

for (let i=0;i<120;i++) Matter.Engine.update(engine, 1000/60);
console.log('带 filter: wheel y =', w.position.y.toFixed(1), '(ground top=700, 应停 ~680)');
console.log('ground.bounds:', JSON.stringify(g.bounds));
