import Matter from 'matter-js';
const engine = Matter.Engine.create();
engine.gravity.y = 1;

// 方式1：density=0 + 手动 isStatic=true（当前 adapter 的做法）
const g1 = Matter.Bodies.rectangle(400, 715, 1700, 50, { density: 0 });
g1.isStatic = true;
Matter.Composite.add(engine.world, g1);
const w1 = Matter.Bodies.circle(400, 660, 20, { density: 0.01 });
Matter.Composite.add(engine.world, w1);

for (let i = 0; i < 120; i++) Matter.Engine.update(engine, 1000/60);
console.log('方式1 (density=0 + isStatic=true): wheel y =', w1.position.y.toFixed(1));
