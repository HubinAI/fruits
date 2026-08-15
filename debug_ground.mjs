import Matter from 'matter-js';
const engine = Matter.Engine.create();
engine.gravity.y = 1;

let startCount = 0, activeCount = 0, endCount = 0;
Matter.Events.on(engine, 'collisionStart', (e) => { startCount += e.pairs.length; });
Matter.Events.on(engine, 'collisionActive', (e) => { activeCount += e.pairs.length; });
Matter.Events.on(engine, 'collisionEnd', (e) => { endCount += e.pairs.length; });

const ground = Matter.Bodies.rectangle(400, 715, 2000, 50, { isStatic: true });
Matter.Composite.add(engine.world, ground);
const wheel = Matter.Bodies.circle(400, 660, 20, { density: 0.01, friction: 0.9 });
Matter.Composite.add(engine.world, wheel);

for (let i = 0; i < 120; i++) {
  Matter.Engine.update(engine, 1000/60);
}
console.log('startCount', startCount, 'activeCount', activeCount, 'endCount', endCount);
console.log('wheel y', wheel.position.y.toFixed(1), 'ground top ~', 715-25);
